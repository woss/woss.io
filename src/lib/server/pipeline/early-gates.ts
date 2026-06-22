import {
  addMessage,
  getChatMessageCount,
  getMessages,
  lockChat,
  incrementOffTopicCount,
  type StoredMessage,
} from '$lib/server/db';
import { embedText } from '$lib/server/embed';
import { checkCache } from '$lib/server/llm-cache';
import { publishLive, publishPersistent } from '$lib/server/chat-events';
import { callWebhook } from '$lib/server/webhooks';
import { config } from '$lib/server/config';
import { CAT, createLogger } from '$lib/server/logger';
import type { ChatMessage } from '$lib/server/openai-provider';
import {
  generatePoliteResponse,
  isRelevant,
  needsGithubTools,
  needsMaculaTools,
  parseSources,
  tryRenameChat,
} from '$lib/server/chat-helpers';
import { classifyToolNeeds } from './tool-classifier';

const log = createLogger(CAT.chat);

/**
 * Pre-generation gates that run before the LLM is called:
 *
 * 1. Relevance check (isRelevant) — rejects off-topic questions, locks the chat
 * 2. Polite-only path — skips embedding, RAG, tools for thank-you messages
 * 3. Embed query text into vector
 * 4. Build composite cache key (current + previous user message)
 * 5. Check semantic cache — return cached answer on hit
 *
 * If all gates pass, returns the embedding data, context messages, history,
 * and the classifyResult from tool-needs classification (if it ran).
 * If a gate handles the request completely, returns { handled: true }.
 */
export async function handleEarlyGates(
  text: string,
  chatId: string,
  userId: string,
  abortController: AbortController,
  userAgentId: number | undefined,
  startTime: number,
): Promise<
  | { handled: true }
  | {
      handled: false;
      embedding: { data: number[]; dimensions: number };
      cacheEmbeddingData: number[];
      cacheText: string;
      ctxMessages: StoredMessage[];
      history: ChatMessage[];
      classifyResult?: Awaited<ReturnType<typeof classifyToolNeeds>>;
    }
> {
  // should get max messages from config. unification
  const ctxMessages = getMessages(chatId, 50);
  const history = ctxMessages.map((m) => ({ role: m.role, content: m.content }));

  // For short ambiguous messages, call classifyToolNeeds once and share the result
  let classifyResult: Awaited<ReturnType<typeof classifyToolNeeds>> | undefined;

  // 1a. Check relevance — reject off-topic questions early
  // Slash commands bypass the relevance gate (user-initiated actions are always on-topic)
  if (!text.startsWith('/summarize')) {
    // Check keyword-based tool intent first (no LLM call)
    const githubKeyword = await needsGithubTools(text, ctxMessages);
    const maculaKeyword = await needsMaculaTools(text, ctxMessages);
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (!githubKeyword && !maculaKeyword && wordCount <= 6 && ctxMessages?.length) {
      classifyResult = await classifyToolNeeds(
        text,
        ctxMessages,
        AbortSignal.timeout(config().openai.toolClassifyTimeoutMs),
      );
    }
    const hasToolIntent =
      githubKeyword ||
      maculaKeyword ||
      classifyResult === 'github' ||
      classifyResult === 'macula' ||
      classifyResult === 'both';
    if (!hasToolIntent) {
      publishLive(chatId, 'status', { step: 'checking_relevance' });
      const relevant = await isRelevant(text, history, abortController.signal);
      if (!relevant) {
        const count = incrementOffTopicCount(chatId);
        log.info`Off-topic question strike ${count}/3 for chat ${chatId}`;
        if (count >= 3) {
          lockChat(chatId);
          const errMsgId = addMessage({
            userId,
            role: 'assistant',
            content: '',
            chatId,
            irrecoverable: true,
            error: "I can only answer questions about Daniel Maricic's professional portfolio and experience.",
            userAgentId,
          });
          await callWebhook({
            type: 'chatLocked',
            chatId,
            reason: `off-topic question (${count}/3). Chat has ${ctxMessages.length} messages, ${getChatMessageCount(chatId)} total messages. Last message: "${text.slice(0, 100)}" with id ${errMsgId}`,
          });
          publishPersistent(chatId, 'error', {
            message: "I can only answer questions about Daniel Maricic's professional portfolio and experience.",
            irrecoverable: true,
            messageId: errMsgId,
          });
        } else {
          const remaining = 3 - count;
          const errMsgId = addMessage({
            userId,
            role: 'assistant',
            content: '',
            chatId,
            error: `I can only answer questions about Daniel Maricic's professional portfolio and experience. This chat will be locked after ${remaining} more off-topic question${remaining === 1 ? '' : 's'}.`,
            userAgentId,
          });
          publishPersistent(chatId, 'error', {
            message: `I can only answer questions about Daniel Maricic's professional portfolio and experience.`,
            messageId: errMsgId,
            attemptsLeft: remaining,
          });
        }
        return { handled: true };
      }
    }
  }

  // 1b. Polite-only messages — skip embedding, RAG, tools. Just respond warmly.
  const politeOnlyPattern =
    /^(thank(s| you|you!)|thanks|cheers|ty|thx|great|awesome|perfect|got it|ok|okay|sure|nice|good|cool|that('s| is) all|that helps|bye|have a good)/i;
  if (politeOnlyPattern.test(text.trim()) && text.trim().split(/\s+/).filter(Boolean).length <= 4) {
    publishLive(chatId, 'status', { step: 'generating' });
    try {
      const politeResponse = await generatePoliteResponse(text, abortController.signal);
      const msgId = addMessage({
        userId,
        role: 'assistant',
        content: politeResponse,
        sources: '',
        chatId,
        userAgentId,
      });
      publishPersistent(chatId, 'done', {
        answer: politeResponse,
        sources: [],
        messageId: msgId,
        usage: { chunks: 0, totalTime: Math.floor(performance.now() - startTime), cached: false },
      });
    } catch (e) {
      log.warn`Polite response generation failed, using fallback: ${e}`;
      const fallback = "You're welcome! I'm glad I could help. Feel free to ask more about Daniel's work.";
      const msgId = addMessage({ userId, role: 'assistant', content: fallback, sources: '', chatId, userAgentId });
      publishPersistent(chatId, 'done', {
        answer: fallback,
        sources: [],
        messageId: msgId,
        usage: { chunks: 0, totalTime: Math.floor(performance.now() - startTime), cached: false },
      });
    }
    tryRenameChat(chatId, text);
    return { handled: true };
  }

  // 1. Embed query
  publishLive(chatId, 'status', { step: 'embedding' });
  let embedding: { data: number[]; dimensions: number };
  try {
    embedding = await embedText(text);
  } catch (e) {
    log.warn`Failed to embed query text: ${e}`;
    const errMsgId = addMessage({
      userId,
      role: 'assistant',
      content: '',
      chatId,
      error: 'Failed to generate embedding',
      userAgentId,
    });
    publishPersistent(chatId, 'error', { message: 'Failed to generate embedding', messageId: errMsgId });
    return { handled: true };
  }

  // 2. Build composite cache key
  let cacheText = text;
  let cacheEmbeddingData = embedding.data;
  const userMessages = ctxMessages.filter((m) => m.role === 'user');
  if (userMessages.length > 1 && userMessages[userMessages.length - 2].content !== text) {
    cacheText = `${userMessages[userMessages.length - 2].content} ${text}`;
    try {
      const ce = await embedText(cacheText);
      cacheEmbeddingData = ce.data;
    } catch (error) {
      log.error('Failed to generate composite embedding', {
        error: error instanceof Error ? error.message : String(error),
      });
      /* fallback */
    }
  }

  // 3. Check semantic cache (skip if disabled via env)
  let cached: { answer: string; sources: string; toolCalls?: { name: string; serverId: string }[] } | null = null;
  if (config().llmCache.enabled) {
    publishLive(chatId, 'status', { step: 'checking_cache' });
    cached = checkCache(cacheEmbeddingData);
  }
  if (cached) {
    log.info`📦 cache HIT for "${text.slice(0, 100)}"`;

    // Emit tool call live events for cached responses
    for (const tc of cached.toolCalls ?? []) {
      const id = 'cached-' + tc.name + '-' + Date.now();
      publishLive(chatId, 'tool_call_start', {
        id,
        name: tc.name,
        serverId: tc.serverId,
        startedAt: Date.now(),
      });
      publishLive(chatId, 'tool_call_end', { id, name: tc.name });
    }

    const msgId = addMessage({
      userId,
      role: 'assistant',
      content: cached.answer,
      sources: cached.sources,
      chatId,
      userAgentId,
      fromCache: true,
    });
    const sources = parseSources(cached.sources);
    const elapsed = performance.now() - startTime;
    publishPersistent(chatId, 'done', {
      answer: cached.answer,
      sources,
      messageId: msgId,
      usage: { chunks: 0, totalTime: Math.floor(elapsed), cached: true },
    });

    tryRenameChat(chatId, text);
    return { handled: true };
  }

  return {
    handled: false,
    embedding,
    cacheEmbeddingData,
    cacheText,
    ctxMessages,
    history,
    classifyResult: classifyResult,
  };
}
