/**
 * Unified OpenAI-compatible LLM provider.
 * Uses Vercel AI SDK streamText + Effect.ts Stream for typed event streaming.
 *
 * Type safety: Uses LLMEvent factory functions instead of type assertions.
 * Primitive values extracted via String()/Number() instead of `as string`/`as number`.
 */
import { config } from '$lib/server/config';
import { CAT, createLogger } from './logger';
import { jsonSchema, streamText } from 'ai';
import { Effect, Stream } from 'effect';
import type { Stream as StreamType } from 'effect/Stream';
import { provider, modelName } from './llm/provider';
import type { LLMEvent, FinishReason, TokenUsage } from './llm/types';
import type { ModelMessage, ToolSet } from 'ai';
import type { McpToolCallResult } from './mcp/client';
import { getSystemPrompt } from './prompts.ts';

/** @group LLMEvent Factory Functions */

function textDeltaEvent(text: string): LLMEvent {
  return { type: 'text-delta', text };
}

function reasoningDeltaEvent(text: string): LLMEvent {
  return { type: 'reasoning-delta', text };
}

function toolCallEvent(id: string, name: string, input: unknown): LLMEvent {
  return { type: 'tool-call', id, name, input };
}

function toolResultEvent(id: string, name: string, result: unknown): LLMEvent {
  return { type: 'tool-result', id, name, result };
}

function toolInputDeltaEvent(id: string, name: string, text: string): LLMEvent {
  return { type: 'tool-input-delta', id, name, text };
}

function stepFinishEvent(reason: FinishReason, toolCalls: number, textProduced: boolean, usage?: TokenUsage): LLMEvent {
  return usage !== undefined
    ? { type: 'step-finish', reason, toolCalls, textProduced, usage }
    : { type: 'step-finish', reason, toolCalls, textProduced };
}

function finishEvent(
  reason: FinishReason,
  actualModelName: string,
  providerUrl: string,
  maxTokens: number,
  usage?: TokenUsage,
  toolLoopDetected?: boolean,
): LLMEvent {
  return {
    type: 'finish',
    reason,
    usage,
    modelName: config().openai.model,
    actualModelName,
    provider: providerUrl,
    maxTokens,
    toolLoopDetected,
  };
}

/** @group ModelMessage Converter */

function toModelMessages(messages: ChatMessage[]): Array<ModelMessage> {
  const result: Array<ModelMessage> = [];
  for (const m of messages) {
    switch (m.role) {
      case 'system':
        result.push({ role: 'system', content: m.content });
        break;
      case 'user':
        result.push({ role: 'user', content: m.content });
        break;
      case 'assistant':
        result.push({ role: 'assistant', content: m.content });
        break;
      case 'tool':
        result.push({
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: m.tool_call_id ?? '',
              toolName: '',
              output: { type: 'text', value: m.content },
            },
          ],
        });
        break;
    }
  }
  return result;
}

const log = createLogger(CAT.llm);

/** @group Types */

interface RagChunk {
  title: string;
  text: string;
  score: number;
}

type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  tool_call_id?: string;
}

/** @group Configuration */

const BASE_URL = config().openai.baseUrl;
const MODEL = config().openai.model;
const MAX_TOKENS = config().openai.maxTokens;
const FIRST_ROUND_MAX_STEPS = config().openai.firstRoundMaxSteps;
const MAX_HISTORY_MESSAGES = 10;

log.debug`[openai-provider] BASE_URL: ${BASE_URL} | MODEL: ${MODEL}`;

/** @group Model Instance */

const model = provider(modelName);

/** @group RAG Prompt Builder */

/** Merge consecutive messages with the same role to satisfy strict role alternation (e.g., Mistral). */
export function mergeSameRole(messages: ChatMessage[]): ChatMessage[] {
  // Disabled — role merging confuses DeepSeek V4 Flash, causes monologue leak
  // return messages.reduce((acc, msg) => {
  //   const last = acc[acc.length - 1];
  //   if (last && last.role === msg.role && msg.role !== 'system') {
  //     last.content += '\n' + msg.content;
  //   } else {
  //     acc.push({ role: msg.role, content: msg.content });
  //   }
  //   return acc;
  // }, [] as ChatMessage[]);
  return messages;
}

/**
 * Build a system prompt enriched with RAG context from relevant chunks.
 * @param question - User's question text
 * @param chunks - Relevant chunks from vector search
 * @param history - Previous conversation messages
 * @returns Array of chat messages with system prompt, history, and current question
 */
export function buildRagPrompt(question: string, chunks: RagChunk[], history?: ChatMessage[]): ChatMessage[] {
  const messages: ChatMessage[] = [];

  let systemPrompt = getSystemPrompt();

  if (chunks.length > 0) {
    const context = chunks
      .map((c, i) => `[${i + 1}] From "${c.title}" (relevance: ${c.score.toFixed(2)}):\n${c.text}`)
      .join('\n\n');
    systemPrompt += `\n\nContext:\n${context}`;
  }

  messages.push({ role: 'system', content: systemPrompt });

  if (history && history.length > 0) {
    // Filter to user/assistant only, then truncate to last MAX_HISTORY_MESSAGES
    // to prevent context buildup that degrades tool-using behavior
    const filtered = history.filter((m) => m.role === 'user' || m.role === 'assistant');
    const slice = filtered.length > MAX_HISTORY_MESSAGES ? filtered.slice(-MAX_HISTORY_MESSAGES) : filtered;
    for (const msg of slice) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  messages.push({ role: 'user', content: question });

  return mergeSameRole(messages);
}

/** @group MCP Tool -> AI SDK ToolSet Converter */

interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * Convert MCP tool definitions to AI SDK ToolSet format.
 * Each tool gets an execute function that delegates to the MCP runtime.
 */
function buildToolSet(
  tools: McpToolDef[],
  executeFn: (tc: { name: string; arguments?: string }) => Promise<McpToolCallResult>,
): ToolSet {
  const toolSet: ToolSet = {};
  for (const tool of tools) {
    toolSet[tool.name] = {
      description: tool.description,
      inputSchema: jsonSchema(tool.inputSchema ?? { type: 'object', properties: {} }),
      execute: async (args: Record<string, unknown>) => {
        try {
          const argsStr = args
            ? Object.entries(args)
                .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                .join(' ')
            : '';
          log.info`⚙ ${tool.name} [${argsStr}]`;
          const result = await executeFn({
            name: tool.name,
            arguments: JSON.stringify(args),
          });
          const toolResult = result.content.map((item) => item.text ?? '').join('');
          log.debug`[buildToolSet] ${tool.name} execute result length=${toolResult.length}, first 200 chars="${toolResult.slice(0, 200)}"`;
          const maxResultLength = config().openai.maxResultsLength;
          const truncated =
            toolResult.length > maxResultLength
              ? toolResult.slice(0, maxResultLength) + '\n\n[... truncated: full output too large]'
              : toolResult;
          return truncated;
        } catch (err) {
          log.error`[buildToolSet] ${tool.name} execute failed: ${err instanceof Error ? err.message : String(err)} stack=${err instanceof Error ? err.stack : 'N/A'}`;
          return `Error executing ${tool.name}: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    };
  }
  return toolSet;
}

/**
 * Stream chat with MCP tool definitions via streamText.
 * Uses maxSteps for automatic multi-round tool execution.
 * Returns a Stream of typed LLMEvents.
 */
export function chatStreamWithTools(
  messages: ChatMessage[],
  mcpToolDefs: McpToolDef[],
  signal?: AbortSignal,
): StreamType<LLMEvent, Error> {
  return Stream.asyncPush<LLMEvent, Error>(
    (emit) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          log.debug`chatStreamWithTools starting, messages: ${messages.length}, tools: ${mcpToolDefs?.length ?? 0}`;

          let aborted = false;
          const hasTools = mcpToolDefs && mcpToolDefs.length > 0;

          const toolSet = hasTools
            ? buildToolSet(mcpToolDefs, async (tc) => {
                const { executeMcpToolCall } = await import('./mcp/tools');
                return executeMcpToolCall(tc);
              })
            : undefined;

          const currentMessages = toModelMessages(messages);

          // Aggregated across all rounds
          let aggregatedUsage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
          let lastFinishReason: string = 'stop';
          let actualModelName: string = config().openai.model;

          const MAX_ROUNDS = config().openai.maxRounds;
          const CROSS_ROUND_THRESHOLD = 3;
          const crossRoundFingerprintCounts = new Map<string, number>();
          let doomLoopDetectedInRound = false;

          async function runRound(round: number, currentToolSet: ToolSet | undefined): Promise<void> {
            if (aborted) return;

            let roundToolCalls = 0;
            let roundTextLength = 0;
            let roundText = '';
            const roundToolResults: string[] = [];
            const roundToolCallRecords: Array<{ toolCallId: string; toolName: string; input: unknown }> = [];

            return new Promise<void>((resolve, reject) => {
              try {
                const result = streamText({
                  model,
                  allowSystemInMessages: true,
                  messages: currentMessages,
                  abortSignal: signal,
                  temperature: 0.2,
                  ...(MAX_TOKENS !== undefined ? { maxTokens: MAX_TOKENS } : {}),
                  ...(currentToolSet ? { tools: currentToolSet, maxSteps: FIRST_ROUND_MAX_STEPS } : {}),
                  onChunk: ({ chunk }) => {
                    if (aborted) return;
                    switch (chunk.type) {
                      case 'text-delta':
                        roundText += chunk.text;
                        roundTextLength += chunk.text.length;
                        emit.single(textDeltaEvent(chunk.text));
                        break;
                      case 'reasoning-delta':
                        emit.single(reasoningDeltaEvent(chunk.text));
                        break;
                      case 'tool-call':
                        roundToolCalls++;
                        roundToolCallRecords.push({
                          toolCallId: chunk.toolCallId,
                          toolName: chunk.toolName,
                          input: chunk.input,
                        });
                        emit.single(toolCallEvent(chunk.toolCallId, chunk.toolName, chunk.input));
                        break;
                      case 'tool-result':
                        log.debug`[onChunk-tool-result] name=${chunk.toolName}, resultType=${typeof chunk.output}, resultLength=${typeof chunk.output === 'string' ? chunk.output.length : JSON.stringify(chunk.output).length}, full=${typeof chunk.output === 'string' ? chunk.output : JSON.stringify(chunk.output)}`;
                        emit.single(toolResultEvent(chunk.toolCallId, chunk.toolName, chunk.output));
                        if (typeof chunk.output === 'string') {
                          roundToolResults.push(chunk.output);
                        } else if (chunk.output && typeof chunk.output === 'object') {
                          try {
                            const text = JSON.stringify(chunk.output).slice(0, 10000);
                            roundToolResults.push(text);
                          } catch (e) {
                            log.warn`Failed to stringify tool result: ${e}`;
                          }
                        }
                        break;
                      case 'tool-input-delta':
                        emit.single(toolInputDeltaEvent(chunk.id, '', chunk.delta));
                        break;
                    }
                  },
                  onError: ({ error }: { error: unknown }) => {
                    log.error`[first-round-error] ${error instanceof Error ? error.message : String(error)} stack=${error instanceof Error ? error.stack : 'N/A'}`;
                  },
                  onFinish: (event) => {
                    lastFinishReason = String(event.finishReason);
                    if (event.response?.modelId) {
                      actualModelName = String(event.response.modelId);
                    }
                    if (event.usage) {
                      aggregatedUsage = {
                        inputTokens: (aggregatedUsage?.inputTokens ?? 0) + Number(event.usage.inputTokens ?? 0),
                        outputTokens: (aggregatedUsage?.outputTokens ?? 0) + Number(event.usage.outputTokens ?? 0),
                        totalTokens:
                          (aggregatedUsage?.totalTokens ?? 0) +
                          Number((event.usage.inputTokens ?? 0) + (event.usage.outputTokens ?? 0)),
                      };
                    }
                  },
                });
                Promise.resolve(result.text)
                  .then(() => {
                    try {
                      if (aborted) return resolve();

                      emit.single(
                        stepFinishEvent(
                          mapFinishReason(lastFinishReason),
                          roundToolCalls,
                          roundTextLength > 0,
                          aggregatedUsage,
                        ),
                      );

                      // Build cross-round tool+args fingerprints for doom loop detection
                      for (const tc of roundToolCallRecords) {
                        const fingerprint = `${tc.toolName}::${JSON.stringify(tc.input)}`;
                        const count = (crossRoundFingerprintCounts.get(fingerprint) ?? 0) + 1;
                        crossRoundFingerprintCounts.set(fingerprint, count);
                        log.debug`[fingerprint] ${fingerprint} count=${count}`;
                      }
                      const toolLoopDetected = [...crossRoundFingerprintCounts.values()].some(
                        (c) => c > CROSS_ROUND_THRESHOLD,
                      );

                      // Only recurse if the model produced text (roundTextLength > 0).
                      // If the model called tools but produced zero text (doom loop),
                      // recursion would feed duplicated tool results back into context
                      // and cause the model to call tools again in a loop.
                      // Skip recursion and resolve immediately — generate.ts's
                      // "Empty answer" / "Doom loop" detection handles the retry.
                      const reachedMaxRounds = round >= MAX_ROUNDS;
                      const isDoomLoop = toolLoopDetected;
                      const INTERIM_PATTERNS = /\b(let me|i'll|i will|i should|i need to)\b/gi;
                      const interimMatchCount = (roundText.match(INTERIM_PATTERNS) ?? []).length;
                      const isInterimRound =
                        roundTextLength > 0 &&
                        roundToolCalls > 0 &&
                        interimMatchCount >= 3 &&
                        !/```|`[^`]+`|\|.*\|.*\||^#+\s/m.test(roundText) &&
                        roundTextLength < 2000;
                      if (isDoomLoop) {
                        log.warn`[llm-round] Cross-round tool loop detected (fingerprint repeat > ${CROSS_ROUND_THRESHOLD}) — forcing final round without tools`;
                        doomLoopDetectedInRound = true;
                      }
                      if (isInterimRound) {
                        log.warn`[llm-round] Interim round detected (${roundToolCalls} tool calls, transitional text without content) — forcing final round without tools`;
                      }
                      if (
                        roundToolCalls > 0 &&
                        roundTextLength > 0 &&
                        !reachedMaxRounds &&
                        !isDoomLoop &&
                        !isInterimRound
                      ) {
                        log.info`[llm-round] ${roundToolCalls} tool calls, ${roundTextLength} text chars — continuing with tools`;

                        // Push assistant's text + tool calls as a single assistant message
                        currentMessages.push({
                          role: 'assistant',
                          content: [
                            ...(roundText ? [{ type: 'text' as const, text: roundText }] : []),
                            ...roundToolCallRecords.map((tc) => ({
                              type: 'tool-call' as const,
                              toolCallId: tc.toolCallId,
                              toolName: tc.toolName,
                              input: tc.input,
                            })),
                          ] as Array<
                            | { type: 'text'; text: string }
                            | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
                          >,
                        });
                        // Push tool results
                        for (let i = 0; i < roundToolCallRecords.length; i++) {
                          const tc = roundToolCallRecords[i];
                          const result = roundToolResults[i] ?? '';
                          currentMessages.push({
                            role: 'tool',
                            content: [
                              {
                                type: 'tool-result' as const,
                                toolCallId: tc.toolCallId,
                                toolName: tc.toolName,
                                output: { type: 'text' as const, value: result },
                              },
                            ],
                          });
                        }

                        log.info`[llm-round-ctx] messages=${currentMessages.length}, roles=${currentMessages.map((m) => m.role).join(',')}`;

                        // Ensure text continuity between rounds
                        if (roundTextLength > 0 && !/\s$/.test(roundText)) {
                          emit.single(textDeltaEvent('\n\n'));
                        }

                        // Recurse runRound with same tool availability
                        runRound(round + 1, currentToolSet)
                          .then(resolve)
                          .catch(reject);
                      } else if (
                        roundToolCalls > 0 &&
                        roundTextLength > 0 &&
                        (reachedMaxRounds || isDoomLoop || isInterimRound)
                      ) {
                        // MAX_ROUNDS reached with tool calls and text — force a final
                        // Force final round without tools so the model must produce text.
                        log.info`[llm-round] MAX_ROUNDS=${MAX_ROUNDS} reached, ${roundToolCalls} tool calls, ${roundTextLength} text chars — forcing final round without tools`;

                        // Push assistant's text + tool calls
                        currentMessages.push({
                          role: 'assistant',
                          content: [
                            ...(roundText ? [{ type: 'text' as const, text: roundText }] : []),
                            ...roundToolCallRecords.map((tc) => ({
                              type: 'tool-call' as const,
                              toolCallId: tc.toolCallId,
                              toolName: tc.toolName,
                              input: tc.input,
                            })),
                          ] as Array<
                            | { type: 'text'; text: string }
                            | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
                          >,
                        });
                        // Push tool results
                        for (let i = 0; i < roundToolCallRecords.length; i++) {
                          const tc = roundToolCallRecords[i];
                          const result = roundToolResults[i] ?? '';
                          currentMessages.push({
                            role: 'tool',
                            content: [
                              {
                                type: 'tool-result' as const,
                                toolCallId: tc.toolCallId,
                                toolName: tc.toolName,
                                output: { type: 'text' as const, value: result },
                              },
                            ],
                          });
                        }

                        // Ensure text continuity
                        if (roundTextLength > 0 && !/\s$/.test(roundText)) {
                          emit.single(textDeltaEvent('\n\n'));
                        }

                        log.info`[llm-round-ctx] messages=${currentMessages.length}, roles=${currentMessages.map((m) => m.role).join(',')}`;

                        // Final round with NO tools — forces the model to produce text
                        runRound(round + 1, undefined)
                          .then(resolve)
                          .catch(reject);
                      } else {
                        resolve();
                      }
                    } catch (e: unknown) {
                      reject(e);
                    }
                  })
                  .catch((err: unknown) => {
                    if (aborted) return resolve();
                    reject(err);
                  });
              } catch (e: unknown) {
                reject(e);
              }
            });
          }

          runRound(1, toolSet)
            .then(() => {
              if (aborted) return;
              aborted = true;

              emit.single(
                finishEvent(
                  mapFinishReason(lastFinishReason),
                  actualModelName,
                  BASE_URL,
                  MAX_TOKENS ?? 0,
                  aggregatedUsage,
                  doomLoopDetectedInRound,
                ),
              );
              emit.end();
            })
            .catch((err: unknown) => {
              if (aborted) return;
              aborted = true;
              if (
                (err instanceof DOMException || err instanceof Error) &&
                (err.name === 'AbortError' || err.name === 'TimeoutError')
              ) {
                emit.end();
              } else {
                emit.fail(err instanceof Error ? err : new Error(String(err)));
              }
            });

          return Effect.sync(() => {
            aborted = true;
          });
        }),
        (cleanup: Effect.Effect<void>) => cleanup,
      ),
    { bufferSize: 'unbounded' },
  );
}

/** @group Finish Reason Mapping */

/**
 * Map a string finish reason from the AI SDK to the internal FinishReason type.
 * @param reason - Finish reason string (stop, tool-calls, error, length, or unknown)
 * @returns The corresponding internal FinishReason enum value
 */
export function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'tool-calls':
      return 'tool-calls';
    case 'error':
      return 'error';
    case 'length':
      return 'length';
    default:
      return 'unknown';
  }
}

/**
 * Check connectivity to the LLM provider by listing available models.
 * @returns True when the configured model is found in the provider model list.
 */
export async function isAvailable(): Promise<boolean> {
  if (!config().openai.apiKey) {
    log.error`[isAvailable] false: no API_KEY`;
    return false;
  }
  const url = `${BASE_URL}/models`;
  log.debug`[isAvailable] fetching: ${url}`;

  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${config().openai.apiKey}` },
    });
  } catch (err) {
    log.error`[isAvailable] fetch threw: ${err}`;
    return false;
  }

  if (!res.ok) {
    log.error`[isAvailable] fetch failed: ${res.status} ${res.statusText}`;
    return false;
  }

  log.debug`[isAvailable] status: ${res.status} ok: ${res.ok}`;

  const models = await res.json();
  const modelExists = models.data.find((model: { id: string }) => model.id === MODEL);

  if (!modelExists) {
    log.error`[isAvailable] model ${MODEL} not found in available models`;
    return false;
  }

  return true;
}
