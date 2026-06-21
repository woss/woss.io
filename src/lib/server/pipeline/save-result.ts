import { addMessage } from '$lib/server/db';
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
  currentModelId: number;
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
    userId,
    chatId,
    userAgentId,
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
      const errMsgId = addMessage({
        userId,
        role: 'assistant',
        content: fallbackText,
        sources: JSON.stringify(sources),
        reasoning: reasoningText,
        chatId,
        modelId: currentModelId,
        tokensIn: tokenUsage.promptTokens,
        tokensOut: tokenUsage.completionTokens,
        durationMs: responseMs,
        maxTokens,
        queryType,
        irrecoverable: irrecoverable || undefined,
        error: 'Failed to generate answer after retries',
        userAgentId,
        fromCache: false,
      });
      log.info('Sending SSE event', {
        event: 'error',
        chatId,
        dataLength: fallbackText.length,
      });
      publishPersistent(chatId, 'error', {
        message: 'Failed to generate answer after retries',
        messageId: errMsgId,
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
    addMessage({
      userId,
      role: 'assistant',
      content: answerText,
      sources: JSON.stringify(sources),
      reasoning: reasoningText,
      chatId,
      modelId: currentModelId,
      tokensIn: tokenUsage.promptTokens,
      tokensOut: tokenUsage.completionTokens,
      durationMs: responseMs,
      maxTokens,
      queryType,
      msgId,
      userAgentId,
      fromCache: false,
    });
  } catch (err) {
    log.error`addMessage failed: ${err}`;
    const errMsgId = addMessage({
      userId,
      role: 'assistant',
      content: '',
      chatId,
      queryType,
      error: 'Failed to save response',
      userAgentId,
      fromCache: false,
    });
    log.info('Sending SSE event', { event: 'error', chatId, dataLength: 'Failed to save response'.length });
    publishPersistent(chatId, 'error', { message: 'Failed to save response', messageId: errMsgId });
    return;
  }

  // Store cache (skip if disabled via env)
  if (config().llmCache.enabled && !partial) {
    try {
      storeCache(cacheEmbeddingData, cacheText, answerText, JSON.stringify(sources), msgId, toolCalls);
    } catch (err) {
      log.error`storeCache failed: ${err}`;
    }
  }
  log.info`✅ done: tokensIn=${tokenUsage.promptTokens} tokensOut=${tokenUsage.completionTokens} durationMs=${responseMs} answerLen=${answerText.length} partial=${partial}`;

  const elapsed = performance.now() - startTime;
  log.info('Sending SSE event', { event: 'done', chatId, dataLength: answerText.length });
  publishPersistent(chatId, 'done', {
    answer: answerText,
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
}
