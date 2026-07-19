import { db } from '$lib/server/db/index';
import { publishPersistent } from '$lib/server/chat-events';
import { CAT, createLogger } from '$lib/server/logger';
import { storeCache } from '$lib/server/llm-cache';
import { config } from '$lib/server/config';

const log = createLogger(CAT.chat);

/**
 * Parameters for saveAndEmitResult — everything needed to persist the answer
 * and emit the final SSE 'done' or 'error' event to the client.
 */
export interface SaveResultParams {
  userId: string;
  chatId: string;
  userAgentId: number | undefined;
  answerText: string;
  reasoningText: string;
  sources: { title: string; score: number; slug: string; url: string; type?: string; chunkCount?: number }[];
  currentModelId: string;
  tokenUsage: { promptTokens: number; completionTokens: number };
  responseMs: number;
  maxTokens: number;
  partial: boolean;
  lastError: Error | null;
  msgId: string;
  cacheEmbeddingData: number[];
  cacheText: string;
  ragChunks: { title: string; text: string; score: number; slug: string; type: string }[];
  queryType: string;
  startTime: number;
  irrecoverable: boolean;
  toolCalls?: { name: string; serverId: string }[];
}

/**
 * Persist the assistant's answer to the messages table and emit the final
 * SSE event ('done' or 'error') to the client.
 *
 * On lastError (retries exhausted): saves the partial answer (if any)
 * or a generic failure message, then emits an 'error' event.
 *
 * On success: saves the full answer, stores in semantic cache, emits 'done'
 * with sources and usage metadata.
 */
function linkContextRefs(text: string, chunks: { slug: string; type: string }[]): string {
  if (!chunks.length) return text;
  const map = new Map<number, string>();
  chunks.forEach((ch, i) => {
    map.set(
      i + 1,
      ch.type === 'experience' ? `/experience/${ch.slug}` : ch.slug === 'about' ? `/about` : `/posts/${ch.slug}`,
    );
  });
  return text.replace(/\(\[Context (\d+)\]\)|\[Context (\d+)\]/g, (match, p1, p2) => {
    const n = parseInt(p1 || p2, 10);
    const url = map.get(n);
    return url ? `[Context ${n}](${url})` : match;
  });
}

export async function saveAndEmitResult(params: SaveResultParams): Promise<void> {
  const {
    chatId,
    answerText: rawAnswerText,
    reasoningText,
    sources,
    currentModelId,
    tokenUsage,
    responseMs,
    maxTokens,
    partial,
    lastError,
    msgId,
    queryType,
    cacheEmbeddingData,
    cacheText,
    ragChunks,
    startTime,
    irrecoverable,
    toolCalls = [],
  } = params;

  if (lastError && !partial) {
    const fallbackText = rawAnswerText.trim()
      ? rawAnswerText
      : "I'm sorry, I wasn't able to generate a response. Please try rephrasing your question.";
    try {
      await db.messages.finalizeMessage(msgId, {
        content: fallbackText,
        sources: JSON.stringify(sources),
        reasoning: reasoningText,
        tokensIn: tokenUsage.promptTokens,
        tokensOut: tokenUsage.completionTokens,
        durationMs: responseMs,
        maxTokens,
        irrecoverable: irrecoverable || undefined,
        error: 'Failed to generate answer after retries',
        fromCache: false,
      });
      await db.messages.setMessageModel(msgId, currentModelId);
      log.info('Sending SSE event', {
        event: 'error',
        chatId,
        dataLength: fallbackText.length,
      });
      await publishPersistent(chatId, 'error', {
        message: 'Failed to generate answer after retries',
        messageId: msgId,
        irrecoverable: irrecoverable === true,
      });
    } catch (e) {
      log.error`Failed to save fallback error message: ${e}`;
    }
    return;
  }

  const answerText = linkContextRefs(rawAnswerText, ragChunks);

  // Save assistant message
  try {
    log.debug`[saveAndEmitResult] finalizeMessage call starting`;
    await db.messages.finalizeMessage(msgId, {
      content: answerText,
      sources: JSON.stringify(sources),
      reasoning: reasoningText,
      tokensIn: tokenUsage.promptTokens,
      tokensOut: tokenUsage.completionTokens,
      durationMs: responseMs,
      maxTokens,
      fromCache: false,
    });
    await db.messages.setMessageModel(msgId, currentModelId);
    log.debug`[saveAndEmitResult] finalizeMessage call completed`;
  } catch (err) {
    log.error`finalizeMessage failed: ${err}`;
    log.debug`[saveAndEmitResult] finalizeMessage failed, starting fallback finalizeMessage`;
    await db.messages.finalizeMessage(msgId, {
      content: '',
      error: 'Failed to save response',
    });
    log.debug`[saveAndEmitResult] fallback finalizeMessage completed, starting publishPersistent(error)`;
    log.info('Sending SSE event', { event: 'error', chatId, dataLength: 'Failed to save response'.length });
    log.debug`[saveAndEmitResult] fallback error path done`;
    await publishPersistent(chatId, 'error', { message: 'Failed to save response', messageId: msgId });
    return;
  }

  // Store cache (skip if disabled via env)
  log.debug`[saveAndEmitResult] storeCache starting`;
  if (config().llmCache.enabled && !partial) {
    try {
      await storeCache(cacheEmbeddingData, cacheText, answerText, JSON.stringify(sources), msgId, toolCalls);
    } catch (err) {
      log.error`storeCache failed: ${err}`;
    }
    log.debug`[saveAndEmitResult] storeCache completed`;
  }
  log.debug`[saveAndEmitResult] publishPersistent(done) starting`;
  log.info`✅ done: tokensIn=${tokenUsage.promptTokens} tokensOut=${tokenUsage.completionTokens} durationMs=${responseMs} answerLen=${answerText.length} partial=${partial}`;

  const elapsed = performance.now() - startTime;
  log.info('Sending SSE event', { event: 'done', chatId, dataLength: answerText.length });
  await publishPersistent(chatId, 'done', {
    answer: answerText,
    reasoning: reasoningText,
    sources,
    messageId: msgId,
    queryType,
    usage: {
      chunks: ragChunks.length,
      totalTime: Math.floor(elapsed),
      modelId: currentModelId,
      tokensIn: tokenUsage.promptTokens,
      tokensOut: tokenUsage.completionTokens,
      durationMs: responseMs,
    },
  });
  log.debug`[saveAndEmitResult] publishPersistent(done) completed`;
}
