import { publishLive, publishPersistent } from '$lib/server/chat-events';
import { callErrorWebhook } from '$lib/server/webhooks';
import { addMessage, getDb, searchChunks } from '$lib/server/db';
import { buildRagPrompt } from '$lib/server/openai-provider';
import { getMcpToolDefs, type McpToolDef } from '$lib/server/mcp/tools';
import { getToolSystemPrompt } from '../prompts.ts';
import { config } from '$lib/server/config';
import { CAT, createLogger } from '$lib/server/logger';
import { classifyQuery, type QueryClass } from '$lib/query-classifier';
import { needsGithubTools, needsMaculaTools, parseSources, tryRenameChat } from '$lib/server/chat-helpers';
import { generateTraceId, withTrace } from '$lib/server/trace-context';

import { handleEarlyGates } from './early-gates';
import { streamWithRetry } from './stream';
import { saveAndEmitResult } from './save-result';

const log = createLogger(CAT.chat);
const SOURCE_SCORE_THRESHOLD = 0.3;

/** Active generation AbortControllers keyed by chatId */
const activeGenerations = new Map<string, AbortController>();

/**
 * Abort an active generation by chatId.
 * Returns true if a generation was found and aborted, false otherwise.
 */
export function abortGeneration(chatId: string): boolean {
  const ac = activeGenerations.get(chatId);
  if (!ac) return false;
  ac.abort();
  activeGenerations.delete(chatId);
  return true;
}

/**
 * Background orchestrator for the full generation pipeline.
 * Called from POST handler without await — runs asynchronously.
 *
 * Pipeline:
 *   1. handleEarlyGates — relevance, polite, embedding, cache
 *   2. classifyQuery — determines if query is rag, tool, or both
 *   3. RAG search (vector similarity on chunk embeddings)
 *   4. (/summarize override — collect sources from conversation history instead)
 *   5. Build RAG prompt with context
 *   6. Conditionally load MCP tools (GitHub/Macula) based on classifyResult + keyword checks
 *   7. Stream from LLM with retry (streamWithRetry)
 *   8. saveAndEmitResult — persist answer, emit SSE done event
 *
 * A 120-second timeout aborts the entire pipeline. The timeout is cleared in finally.
 */
export async function startGeneration(
  text: string,
  chatId: string,
  userId: string,
  maxChunks: number,
  userAgentId?: number,
  userMsgId?: string,
  msgTraceId?: string,
): Promise<void> {
  // If a message traceId is provided, wrap the entire generation in that trace context
  // so all addMessage calls and LLM operations inherit the message traceId
  if (msgTraceId) {
    return withTrace(msgTraceId, generateTraceId(), () =>
      startGeneration(text, chatId, userId, maxChunks, userAgentId, userMsgId),
    );
  }

  const abortController = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  activeGenerations.set(chatId, abortController);

  const startTime = performance.now();
  log.info`📝 ask: "${text.slice(0, 100)}" [chatId=${chatId} userId=${userId}]`;

  try {
    // Publish user_message event
    log.info('Sending SSE event', { event: 'user_message', chatId, dataLength: text.length });
    publishPersistent(chatId, 'user_message', { text, userId });

    // 1a-3: Early gates — relevance, polite, embedding, cache
    const earlyResult = await handleEarlyGates(text, chatId, userId, abortController, userAgentId, startTime);
    if (earlyResult.handled) return;
    const { embedding, cacheEmbeddingData, cacheText, ctxMessages, history, classifyResult } = earlyResult;

    // 4. Classify query — skip RAG for tool-only, skip tools for rag
    const queryType: QueryClass = classifyQuery(embedding.data);
    log.info`🎯 queryType=${queryType} "${text.slice(0, 80)}"`;
    // Persist query_type on the user message
    if (userMsgId) {
      getDb().prepare('UPDATE messages SET query_type = ? WHERE id = ?').run(queryType, userMsgId);
    }

    // 5. RAG search (skip for tool-only queries)
    let ragChunks: { title: string; text: string; score: number; slug: string; type: string }[] = [];
    let sources: { title: string; score: number; slug: string; url: string; type?: string }[] = [];

    // 5b. Detect tool needs BEFORE RAG gate — keyword matching may identify tools even when
    // classifyQuery returns 'hybrid' (below threshold) or classifyResult is undefined (keyword path).
    let mcpToolDefs: McpToolDef[] | null = null;
    const githubNeeded =
      classifyResult === 'github' || classifyResult === 'both' || (await needsGithubTools(text, ctxMessages));
    const maculaNeeded =
      classifyResult === 'macula' || classifyResult === 'both' || (await needsMaculaTools(text, ctxMessages));
    if (queryType !== 'tool' && queryType !== 'meta') {
      publishLive(chatId, 'status', { step: 'searching' });
      // Search more candidates for type-balanced selection
      const results = searchChunks(embedding.data, maxChunks * 3);
      const filtered = results.filter((r) => r.score < SOURCE_SCORE_THRESHOLD);
      if (filtered.length === 0) {
        log.warn`All ${results.length} RAG chunks filtered by score threshold ${SOURCE_SCORE_THRESHOLD} — no sources available`;
      }

      // Split by type for balanced selection
      const postChunks = filtered.filter((r) => r.chunk.type === 'post');
      const experienceChunks = filtered.filter((r) => r.chunk.type === 'experience');

      // Round-robin interleave by type to ensure diversity
      const selected: typeof filtered = [];
      let pi = 0,
        ei = 0;
      while (selected.length < maxChunks && (pi < postChunks.length || ei < experienceChunks.length)) {
        if (ei < experienceChunks.length && (selected.length % 2 === 1 || pi >= postChunks.length)) {
          selected.push(experienceChunks[ei++]);
        } else if (pi < postChunks.length) {
          selected.push(postChunks[pi++]);
        } else if (ei < experienceChunks.length) {
          selected.push(experienceChunks[ei++]);
        } else {
          break;
        }
      }

      ragChunks = selected.map((r) => ({
        title: r.chunk.title,
        text: r.chunk.text,
        score: r.score,
        slug: r.chunk.slug,
        type: r.chunk.type,
      }));

      // Count chunks per slug before dedup for sidebar display
      const slugCounts = new Map<string, number>();
      selected.forEach((r) => {
        const slug = r.chunk.slug;
        slugCounts.set(slug, (slugCounts.get(slug) || 0) + 1);
      });

      const seen = new Set<string>();
      sources = selected
        .filter((r) => {
          if (seen.has(r.chunk.slug)) return false;
          seen.add(r.chunk.slug);
          return true;
        })
        .map((r) => ({
          title: r.chunk.title,
          score: r.score,
          slug: r.chunk.slug,
          url:
            r.chunk.type === 'experience'
              ? `/experience/${r.chunk.slug}`
              : r.chunk.slug === 'about'
                ? `/about`
                : `/posts/${r.chunk.slug}`,
          type: r.chunk.type,
          chunkCount: slugCounts.get(r.chunk.slug) ?? 1,
        }));
    }

    // Auto-rename "New Chat" to user's first message (all paths)
    tryRenameChat(chatId, text);

    // For /summarize, use all unique sources from conversation history instead of RAG results.
    // RAG search on "/summarize" returns chunks unrelated to the conversation topics.
    if (text.startsWith('/summarize')) {
      ragChunks = [];
      const seen = new Set<string>();
      sources = ctxMessages
        .filter((m) => m.role === 'assistant' && m.sources)
        .flatMap((m) => parseSources(m.sources))
        .filter((s) => {
          if (!s.slug) return false;
          if (seen.has(s.slug)) return false;
          seen.add(s.slug);
          return true;
        })
        .map((s) => ({
          title: s.title,
          score: s.score,
          slug: s.slug ?? '',
          url: s.url ?? '',
        }));

      // Replace user message with a summarization prompt
      text =
        'Summarize the above conversation using only information explicitly present in the messages. Do not add projects, companies, roles, or details not mentioned in the conversation. If something is mentioned briefly, state it briefly — do not elaborate.';
    }

    // 6. Build RAG prompt
    const messages = buildRagPrompt(text, ragChunks, history);

    // 6b. Conditionally load MCP tools
    // githubNeeded and maculaNeeded already computed above in step 5b

    if (githubNeeded || maculaNeeded) {
      try {
        const toolDefs = await getMcpToolDefs();
        if (toolDefs.length > 0) {
          mcpToolDefs = toolDefs;
          log.info`🔧 tools: ${toolDefs.map((t: McpToolDef) => t.name).join(', ')}`;
          // Inject tool awareness into system prompt (always first message)
          if (messages.length > 0 && messages[0].role === 'system') {
            const additions = getToolSystemPrompt({ github: githubNeeded, macula: maculaNeeded });
            messages[0] = {
              ...messages[0],
              content: messages[0].content + '\n\n' + additions,
            };
          }
        }
      } catch (err) {
        log.error`Failed to load MCP tools: ${err}`;
        // Non-fatal — continue without tools
      }
    } else {
      log.info`📚 RAG-only mode (no external tools needed for this query)`;
    }

    // Build tool name → serverId map for tool timing instrumentation
    const toolServerMap = new Map<string, string>();
    for (const def of mcpToolDefs ?? []) {
      toolServerMap.set(def.name, def.serverId ?? 'unknown');
    }

    // 7. Stream from OpenRouter with retry
    log.info('Starting LLM stream', { round: 1, totalRounds: 1, chatId });
    // Start generation timeout right before the real LLM call to exclude early-gate overhead
    timeoutId = setTimeout(() => abortController.abort(), 300_000);
    timeoutId?.unref?.();
    const streamResult = await streamWithRetry(messages, mcpToolDefs, chatId, abortController, toolServerMap);
    const {
      answerText,
      reasoningText,
      currentModelId,
      tokenUsage,
      responseMs,
      maxTokens,
      lastError,
      partial,
      msgId,
      irrecoverable,
      toolCalls = [],
    } = streamResult;

    // Fire error webhook on LLM error
    if (lastError) {
      const model = config().openai.model;
      let provider = '';
      try {
        provider = new URL(config().openai.baseUrl).hostname;
      } catch {
        log.debug`Failed to parse baseUrl for error webhook`;
      }
      const statusCode =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        typeof (lastError as any).status === 'number' && (lastError as any).status > 0
          ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (lastError as any).status
          : Number((lastError as Error).message.match(/ (\d{3}) /)?.[1] ?? 0);
      log.info`🚨 LLM error detected — firing error webhook`;
      callErrorWebhook({
        error: `[first-round-error] "${lastError.message}" stack="${lastError.stack}"`,
        userId,
        chatId,
        model,
        provider,
        status: statusCode,
      });
    }

    // 8. Save result, store cache, emit done
    await saveAndEmitResult({
      userId,
      chatId,
      userAgentId,
      answerText,
      reasoningText,
      sources,
      currentModelId,
      tokenUsage,
      responseMs,
      maxTokens,
      partial,
      lastError,
      msgId,
      cacheEmbeddingData,
      cacheText,
      ragChunks,
      queryType,
      startTime,
      irrecoverable,
      toolCalls,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error`Background generation failed: ${err}`;
    try {
      const errMsgId = addMessage({
        userId,
        role: 'assistant',
        content: '',
        chatId,
        irrecoverable: true,
        error: message,
        userAgentId,
      });
      publishPersistent(chatId, 'error', { message, messageId: errMsgId, irrecoverable: true });
    } catch (innerErr) {
      log.error('Failed to publish error SSE event after generation failure', {
        error: innerErr instanceof Error ? innerErr.message : String(innerErr),
      });
    }
  } finally {
    activeGenerations.delete(chatId);
    clearTimeout(timeoutId);
  }
}
