import { publishLive } from '$lib/server/chat-events';
import { ensureModel, getDb } from '$lib/server/db';
import { chatStreamWithTools } from '$lib/server/openai-provider';
import type { LLMEvent } from '$lib/server/llm/types';
import type { McpToolDef } from '$lib/server/mcp/tools';
import { getDoomLoopRecoveryPrompt } from '../prompts.ts';
import { hasDsmlBlocks, stripDsmlBlocks } from './dsml-parser.ts';
import { config } from '$lib/server/config';
import { setMsgId } from '../trace-context.ts';
import { CAT, createLogger } from '$lib/server/logger';
import type { ChatMessage } from '$lib/server/openai-provider';
import { Effect, Stream } from 'effect';
import { randomUUID } from '$lib/utils/random-uuid';

const log = createLogger(CAT.chat);

/**
 * Minimum stripped answerLen (chars) after tool calls to trigger stuck-loop retry.
 * Log analysis Jun 2026 over 4 XML-stripping incidents showed min legitimate
 * post-strip answerLen = 196. Set below that floor to avoid false positives
 * on short-but-valid answers while catching stuck post-tool responses.
 */
const TINY_TEXT_THRESHOLD = 171;

/**
 * Streaming text filter that removes <tool_calls>...</tool_calls> XML blocks.
 *
 * State machine handles blocks that span multiple streamed chunks:
 * - Opening tag in chunk N, closing tag in chunk N+M
 * - Both tags in the same chunk
 *
 * Designed as a reusable class — instantiate per LLM stream, call `next(chunk)`
 * for each text-delta to get the filtered text.
 *
 * Uses regex matching to handle prefixed variants like <||DMSL||tool_calls>
 * that some LLMs spontaneously generate as self-obfuscation.
 *
 * Edge case not handled: tag split across token boundaries (e.g. `<tool_` + `calls>`)
 * is extremely rare with LLM tokenizers and would only leak partial text briefly.
 */
export class ToolCallXmlStripper {
  #inBlock = false;
  #openRe = /<[^>]*tool_calls[^>]*>/i;
  #closeRe = /<\/[^>]*tool_calls[^>]*>/i;

  /** Process a text chunk and return only text NOT inside <tool_calls> blocks. */
  next(chunk: string): string {
    if (this.#inBlock) return this.#drain(chunk);
    return this.#fill(chunk);
  }

  /** True when currently inside a <tool_calls> block. */
  get isInside(): boolean {
    return this.#inBlock;
  }

  // --- private ---

  #fill(chunk: string): string {
    const match = chunk.match(this.#openRe);
    if (!match) return chunk;

    this.#inBlock = true;
    const before = chunk.slice(0, match.index!);
    const after = chunk.slice(match.index! + match[0].length);

    // Closing tag could be in same chunk
    const closeMatch = after.match(this.#closeRe);
    if (closeMatch) {
      this.#inBlock = false;
      return before + after.slice(closeMatch.index! + closeMatch[0].length);
    }

    return before;
  }

  #drain(chunk: string): string {
    const match = chunk.match(this.#closeRe);
    if (!match) return '';

    this.#inBlock = false;
    return chunk.slice(match.index! + match[0].length);
  }
}

/**
 * Return type of streamWithRetry — the full streaming result including
 * accumulated text, token usage, model info, and error/partial state.
 */
interface StreamResult {
  answerText: string;
  reasoningText: string;
  currentModelId: number;
  tokenUsage: { promptTokens: number; completionTokens: number };
  responseMs: number;
  maxTokens: number;
  anyStepHadToolCalls: boolean;
  lastError: Error | null;
  partial: boolean;
  msgId: string;
  toolLoopDetected: boolean;
  irrecoverable: boolean;
  toolCalls?: { name: string; serverId: string }[];
}

/**
 * Stream LLM response with automatic retry (up to 3 attempts).
 *
 * Retry triggers:
 *   - Empty answer (text-delta produced no characters)
 *   - Doom loop (tools were called but no text was produced)
 *
 * On retry, tools are disabled (mcpToolDefs = null) and the system prompt
 * is hardened with a mandatory instruction to produce text without calling tools.
 *
 * Sub-stream processing:
 *   - Converts GitHub PR/issue references (owner/repo#123) to markdown links
 *   - Flattens nested markdown lists
 *   - Safety net: catches raw tool call JSON that slipped through and replaces it
 *     with a fallback message (defense-in-depth for the tool-needs classifier bug)
 *
 * Tool calls are tracked in the tool_calls SQLite table with timestamps and result sizes.
 */
export async function streamWithRetry(
  messages: ChatMessage[],
  mcpToolDefs: McpToolDef[] | null,
  chatId: string,
  abortController: AbortController,
  toolServerMap: Map<string, string>,
): Promise<StreamResult> {
  publishLive(chatId, 'status', { step: 'generating' });
  let lastError: Error | null = null;
  let partial = false;
  let answerText = '';
  let reasoningText = '';

  let currentModelId = 0;
  let tokenUsage = { promptTokens: 0, completionTokens: 0 };
  let responseMs = 0;
  let maxTokens = 0;

  log.debug`mcpToolDefs: ${mcpToolDefs?.map((t) => t.name).join(', ') ?? 'none'}`;

  let anyStepHadToolCalls = false;
  let anySuccessfulToolCalls = false;
  let doomLoopDetectedInRound = false;
  const collectedToolCalls: { name: string; serverId: string }[] = [];

  // Pre-generate message ID for tool-call FK tracking
  const db = getDb();
  const msgId = randomUUID();
  setMsgId(msgId);
  const toolCallStmt = db.prepare(
    `INSERT INTO tool_calls (id, message_id, name, server_id, tool_input, started_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
  );
  const toolCallFinishStmt = db.prepare(
    `UPDATE tool_calls SET finished_at = datetime('now'), tool_output = ?, result_size = ? WHERE id = ?`,
  );

  // change from 3 to 10 attempts after adding retry-on-doom-loop logic, to give the model more chances to recover with tools disabled
  const baseSystemPrompt = messages[0].content;
  let irrecoverable = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const xmlStripper = new ToolCallXmlStripper();
      const llmStream = mcpToolDefs
        ? chatStreamWithTools(messages, mcpToolDefs, abortController.signal)
        : chatStreamWithTools(messages, [], abortController.signal);

      const streamStartTime = performance.now();

      await Effect.runPromise(
        Stream.runForEach(llmStream, (event: LLMEvent) =>
          Effect.sync(() => {
            switch (event.type) {
              case 'text-delta':
                answerText += event.text;
                {
                  const filtered = xmlStripper.next(event.text);
                  if (filtered) {
                    publishLive(chatId, 'token', { token: filtered });
                  }
                }
                break;
              case 'reasoning-delta':
                reasoningText += event.text;
                break;
              case 'finish': {
                if (event.actualModelName || event.modelName) {
                  currentModelId = ensureModel(
                    event.provider ?? String(config().openai.baseUrl),
                    event.modelName ?? config().openai.model,
                    event.actualModelName ?? event.modelName ?? config().openai.model,
                    event.maxTokens ?? config().openai.maxTokens,
                  );
                }
                if (event.usage) {
                  tokenUsage = {
                    promptTokens: event.usage.inputTokens ?? 0,
                    completionTokens: event.usage.outputTokens ?? 0,
                  };
                }
                maxTokens = event.maxTokens ?? config().openai.maxTokens;
                responseMs = Math.floor(performance.now() - streamStartTime);
                if ('toolLoopDetected' in event && event.toolLoopDetected === true) {
                  doomLoopDetectedInRound = true;
                }
                break;
              }
              case 'step-finish':
                if (event.toolCalls > 0) anyStepHadToolCalls = true;
                break;
              case 'tool-call':
                log.debug`Tool call: ${event.name}(${JSON.stringify(event.input)})`;
                collectedToolCalls.push({
                  name: event.name,
                  serverId: toolServerMap.get(event.name) ?? 'unknown',
                });
                publishLive(chatId, 'tool_call_start', {
                  id: event.id,
                  name: event.name,
                  serverId: toolServerMap.get(event.name) ?? 'unknown',
                  startedAt: Date.now(),
                });
                try {
                  toolCallStmt.run(
                    event.id,
                    msgId,
                    event.name,
                    toolServerMap.get(event.name) ?? 'unknown',
                    JSON.stringify(event.input ?? {}),
                  );
                } catch (e) {
                  log.error`Failed to record tool call: ${e}`;
                }
                break;
              case 'tool-result':
                log.debug`Tool result: ${event.name}`;
                publishLive(chatId, 'tool_call_end', { id: event.id, name: event.name });
                try {
                  const resultStr = typeof event.result === 'string' ? event.result : JSON.stringify(event.result);
                  const resultSize = resultStr.length;
                  toolCallFinishStmt.run(resultStr, resultSize, event.id);
                  // Track successful (non-error) tool results for doom loop detection
                  if (!resultStr.includes('Tool returned an error')) {
                    anySuccessfulToolCalls = true;
                  }
                } catch (e) {
                  log.error`Failed to record tool result: ${e}`;
                }
                break;
            }
          }),
        ),
      );
      log.debug`RAW_LLM_OUTPUT:\n${answerText}`;

      // DSML handling: strip DeepSeek DSML tool call blocks from output
      {
        const modelRow = db
          .prepare('SELECT model_name, actual_model_name FROM models WHERE id = ?')
          .get(currentModelId) as { model_name: string; actual_model_name: string } | undefined;
        const isDeepSeekModel =
          modelRow && (/deepseek/i.test(modelRow.model_name) || /deepseek/i.test(modelRow.actual_model_name));

        if (isDeepSeekModel && hasDsmlBlocks(answerText)) {
          answerText = stripDsmlBlocks(answerText).trim();
          log.debug`DSML blocks stripped from output, remaining text length: ${answerText.length}`;
        }
      }

      // Post-stream: convert GitHub PR/issue references to clickable markdown links
      answerText = answerText.replace(
        /([a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)\s*\(#(\d+)\)/g,
        (match: string, repo: string, issue: string, offset: number) => {
          const after = answerText.slice(offset + match.length, offset + match.length + 2);
          if (after === '](') return match;
          return `[${repo}#${issue}](https://github.com/${repo}/pull/${issue})`;
        },
      );

      // Flatten nested markdown lists — strip indentation before list markers
      answerText = answerText.replace(/^(\s{2,})([-*+]\s)/gm, '$2');
      // Replace ```tool_call fenced blocks with plain code blocks — LLM sometimes outputs fake tool calls as markdown which crashes syntax highlighters
      answerText = answerText.replace(/```tool_call\n/g, '```\n');

      // Safety net: if answer contains raw tool call JSON (tool function name followed by {),
      // replace with a fallback message. This catches cases where the LLM outputs tool calls
      // as text (e.g., when tools weren't properly enabled).
      if (
        /^(?:\s*\n)*(?:get_file|search_files|list_files|search_code|search_issues|search_pull_requests|list_issues|list_pull_requests|get_file_contents|create_or_update_file)\s*\{/i.test(
          answerText.trim(),
        )
      ) {
        log.warn`Raw tool call JSON detected in LLM output — replacing with fallback`;
        answerText = "I'm sorry, I encountered a tool configuration issue. Please try asking your question again.";
      }

      // Safety net: strip XML tool call artifacts (e.g. <tool_calls><invoke name="traverse">...</invoke></tool_calls>)
      const xmlPattern = /<[^>]*tool_calls[^>]*>[\s\S]*?<\/[^>]*tool_calls[^>]*>/i;
      if (xmlPattern.test(answerText)) {
        log.warn`XML tool call pattern detected in LLM output — stripping`;
        answerText = answerText.replace(xmlPattern, '').trim();
      }

      lastError = null;

      // Retry if answer is empty, doom loop, tiny text, or tool loop detected
      const isTinyText =
        anySuccessfulToolCalls && answerText.trim().length > 0 && answerText.trim().length < TINY_TEXT_THRESHOLD;
      const isDoomLoop = anySuccessfulToolCalls && answerText.trim().length === 0;
      const isToolLoop = doomLoopDetectedInRound;

      // Hallucination guard: Macula tools available, zero calls made, output has Macula URLs
      const maculaToolNames = ['traverse', 'get_users', 'get_file', 'get_file_metadata'];
      const hasMaculaTools = mcpToolDefs?.some((d) => maculaToolNames.includes(d.name)) ?? false;
      const hasFabricatedUrls = /https?:\/\/(?:u\.)?macula\.link\//i.test(answerText);
      const isHallucination =
        hasMaculaTools && !anyStepHadToolCalls && hasFabricatedUrls && answerText.trim().length > 0;

      // Interim text detection: 3+ transitional phrases, no structural content
      const INTERIM_PATTERNS = /\b(let me|i'll|i will|i should|i need to)\b/gi;
      const interimMatchCount = (answerText.match(INTERIM_PATTERNS) ?? []).length;
      const hasContentStructure = /```|`[^`]+`|\|.*\|.*\||^#+\s/m.test(answerText);
      const isInterimText = interimMatchCount >= 3 && !hasContentStructure && answerText.trim().length < 2000;

      if (
        answerText.trim().length === 0 ||
        isDoomLoop ||
        isTinyText ||
        isToolLoop ||
        isHallucination ||
        isInterimText
      ) {
        const reason = isHallucination
          ? 'Hallucination (tools available, zero calls, Macula URLs in output)'
          : isToolLoop
            ? 'Tool loop detected (cross-round fingerprint repeat)'
            : isDoomLoop || answerText.trim().length === 0
              ? 'Doom loop (tools called, no text)'
              : isInterimText
                ? 'Interim text (transitional phrases, no content)'
                : 'Stuck loop (tools called, tiny text)';
        log.warn`${reason}, retrying (attempt ${attempt + 1})`;
        if (messages.length > 0 && messages[0].role === 'system') {
          // Reset to base system prompt + current retry's recovery prompt (avoid unbounded growth)
          const recovery = isHallucination
            ? 'WARNING — Your previous response contained fabricated Macula URLs. You did not call any Macula tools to retrieve real data. MANDATORY: You MUST call Macula tools (traverse, get_users, get_file) to get actual file data. Do NOT generate URLs from memory.'
            : getDoomLoopRecoveryPrompt();
          messages[0] = {
            ...messages[0],
            content: baseSystemPrompt + '\n\n' + recovery,
          };
        }
        lastError = new Error(reason);
        // Disable tools sooner — drop on attempt 3 instead of 4
        if (attempt === 3) mcpToolDefs = null;
        continue;
      }

      break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const errorStack = err instanceof Error ? err.stack : 'no stack';
      log.error`Stream attempt ${attempt + 1} failed: ${lastError.message} stack=${errorStack}`;
      if (abortController.signal.aborted) {
        partial = true;
        break;
      }
      // Non-recoverable errors: break immediately instead of wasting retries.
      // The AI SDK already retried 3x internally before throwing here.
      const msg = lastError.message.toLowerCase();
      const nonRecoverable = [
        'rate limit',
        'rate_limit',
        ' 429 ',
        'not supported',
        'model not found',
        'process has terminated',
        'signal: killed',
        'unauthorized',
        'forbidden',
        ' 401 ',
        ' 403 ',
      ];
      if (nonRecoverable.some((p) => msg.includes(p))) {
        log.warn`Non-recoverable error detected (${lastError.message}), aborting retry loop`;
        partial = true;
        irrecoverable = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
    }
  }

  return {
    answerText,
    reasoningText,
    currentModelId,
    tokenUsage,
    responseMs,
    maxTokens,
    anyStepHadToolCalls,
    lastError,
    partial,
    msgId,
    toolLoopDetected: doomLoopDetectedInRound,
    irrecoverable,
    toolCalls: collectedToolCalls,
  };
}
