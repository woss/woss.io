import { error, fail } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { PageServerLoad, Actions } from './$types';
import {
  getMessages,
  getChatMessageCount,
  lockChat,
  isChatLocked,
  addMessage,
  getOrCreateUserAgent,
  deleteChat,
  getChat,
  getToolCallsForMessages,
} from '$lib/server/db';
import { config as clientConfig } from '$lib/config';
import { callWebhook } from '$lib/server/webhooks';
import { checkRateLimit } from '$lib/server/rate-limiter';
import { isAvailable } from '$lib/server/openai-provider';
import { startGeneration, abortGeneration } from '$lib/server/generate';
import { generateTraceId, generateSpanId, withTrace } from '$lib/server/trace-context';
import { CAT, createLogger } from '$lib/server/logger';
import { setReaction, deleteReaction, softDeleteMessage } from '$lib/server/db';
import { lookupCountry } from '$lib/server/geo';
import { sanitizeText } from '$lib/server/sanitize';

const log = createLogger(CAT.chat);

function getClientIP(event: import('@sveltejs/kit').RequestEvent): string {
  return event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? event.getClientAddress();
}

export const actions: Actions = {
  ask: async (event) => {
    try {
      const chatId = event.params.id;
      if (!chatId) return fail(400, { error: 'chatId required' });

      const fd = await event.request.formData();
      const text = sanitizeText(String(fd.get('text') ?? ''));
      const userId = String(fd.get('userId') ?? '');

      log.info('Chat ask action', { chatId, textLength: text.length });

      if (!text) return fail(400, { error: 'text is required' });
      if (text.length > 500) return fail(400, { error: 'text must be 500 characters or fewer' });

      let maxChunks = parseInt(String(fd.get('maxChunks') ?? '8'), 10);
      if (!Number.isInteger(maxChunks) || maxChunks < 1 || maxChunks > 20) maxChunks = 8;

      if (!userId || typeof userId !== 'string') return fail(400, { error: 'userId required' });

      const msgCount = getChatMessageCount(chatId);
      if (msgCount >= clientConfig.public.maxMessages) {
        lockChat(chatId);
        return fail(400, {
          error: `Chat has reached maximum of ${clientConfig.public.maxMessages} messages`,
          locked: true,
        });
      }

      const ip = getClientIP(event);
      const rateCheck = checkRateLimit(ip);
      if (!rateCheck.allowed) return fail(429, { error: 'Rate limit exceeded', resetAt: rateCheck.resetAt });

      const userAgentId = event.request.headers.get('user-agent')
        ? getOrCreateUserAgent(event.request.headers.get('user-agent')!, ip)
        : undefined;
      if (!(await isAvailable())) return fail(503, { error: 'AI service is not available' });

      if (isChatLocked(chatId)) return fail(400, { error: 'This chat has been locked', locked: true });

      const chat = getChat(chatId);
      if (!chat) return fail(404, { error: 'Chat not found' });
      if (!dev && chat.userId !== userId) return fail(403, { error: 'Not authorized' });

      // Generate message traceId for this exchange
      const msgTraceId = generateTraceId();

      const userMsgId = withTrace(msgTraceId, generateSpanId(), () =>
        addMessage({ userId, role: 'user', content: text, chatId, userAgentId }),
      );

      startGeneration(text, chatId, userId, maxChunks, userAgentId, userMsgId, msgTraceId);

      return { accepted: true, chatId };
    } catch (e) {
      log.error`Ask action failed for chat ${event.params.id}: ${e}`;
      return fail(500, { error: 'An unexpected error occurred' });
    }
  },

  delete: async (event) => {
    try {
      const fd = await event.request.formData();
      const chatId = String(fd.get('chatId') ?? '');
      const userId = String(fd.get('userId') ?? '');
      if (!chatId) return fail(400, { error: 'chatId required' });
      if (!userId) return fail(400, { error: 'userId required' });

      const chat = getChat(chatId);
      if (!chat) return fail(404, { error: 'Chat not found' });
      if (!dev && chat.userId !== userId) return fail(403, { error: 'Not authorized' });

      deleteChat(chatId);
      await callWebhook({ type: 'chatDeleted', chatId });

      return { success: true, chatId };
    } catch (e) {
      log.error`Delete action failed for chat ${event.params.id}: ${e}`;
      return fail(500, { error: 'An unexpected error occurred' });
    }
  },

  'store-message': async (event) => {
    try {
      const chatId = event.params.id;
      if (!chatId) return fail(400, { error: 'chatId required' });

      const fd = await event.request.formData();
      const userId = String(fd.get('userId') ?? '');
      const role = String(fd.get('role') ?? '');
      const content = String(fd.get('content') ?? '');

      if (!userId) return fail(400, { error: 'userId required' });
      if (!role) return fail(400, { error: 'role required' });
      if (role !== 'user' && role !== 'assistant') return fail(400, { error: 'role must be user or assistant' });
      if (!content) return fail(400, { error: 'content required' });

      const chat = getChat(chatId);
      if (!chat) return fail(404, { error: 'Chat not found' });
      if (!dev && chat.userId !== userId) return fail(403, { error: 'Not authorized' });

      addMessage({ userId, role: role as 'user' | 'assistant', content, chatId });

      return { success: true };
    } catch (e) {
      log.error`Store-message action failed for chat ${event.params.id}: ${e}`;
      return fail(500, { error: 'An unexpected error occurred' });
    }
  },

  reaction: async (event) => {
    const chatId = event.params.id;
    if (!chatId) return fail(400, { error: 'chatId required' });

    const fd = await event.request.formData();
    const messageId = String(fd.get('messageId') ?? '');
    const userId = String(fd.get('userId') ?? '');
    const mode = String(fd.get('mode') ?? '');
    const reactionType = String(fd.get('reactionType') ?? '') as 'up' | 'down' | 'heart';
    const reason = String(fd.get('reason') ?? '');

    if (!messageId) return fail(400, { error: 'messageId required' });
    if (!userId) return fail(400, { error: 'userId required' });

    const log = createLogger(CAT.chat);

    if (mode === 'remove') {
      try {
        deleteReaction(messageId, userId);
        const ua = event.request.headers.get('user-agent') ?? 'unknown';
        const ip = getClientIP(event);
        const country = lookupCountry(ip);
        callWebhook({
          type: 'reactionRemoved',
          messageId,
          reason: 'Reaction removed',
          userAgent: ua,
          country: country ?? undefined,
        }).catch(() => {});
        return { success: true };
      } catch (err) {
        log.error`Failed to delete reaction: ${err}`;
        return fail(500, { error: 'Internal server error' });
      }
    }

    // Default: set reaction
    if (!reactionType || !['up', 'down', 'heart'].includes(reactionType)) {
      return fail(400, { error: "reactionType must be 'up', 'down', or 'heart'" });
    }

    try {
      setReaction(messageId, userId, reactionType, reason || undefined);
      const ua = event.request.headers.get('user-agent') ?? 'unknown';
      const ip = getClientIP(event);
      const country = lookupCountry(ip);
      const webhookType =
        reactionType === 'up'
          ? ('messageUpvote' as const)
          : reactionType === 'heart'
            ? ('messageHeart' as const)
            : ('messageDownvote' as const);
      callWebhook({
        type: webhookType,
        messageId,
        reason: reason?.trim() || undefined,
        userAgent: ua,
        country: country ?? undefined,
      }).catch(() => {});
      return { success: true };
    } catch (err) {
      log.error`Failed to save reaction: ${err}`;
      return fail(500, { error: 'Internal server error' });
    }
  },

  report: async (event) => {
    const chatId = event.params.id;
    if (!chatId) return fail(400, { error: 'chatId required' });

    const fd = await event.request.formData();
    const messageId = String(fd.get('messageId') ?? '');
    const userId = String(fd.get('userId') ?? '');
    const reason = String(fd.get('reason') ?? '');

    if (!messageId) return fail(400, { error: 'messageId required' });
    if (!userId) return fail(400, { error: 'userId required' });
    if (!reason || !reason.trim()) return fail(400, { error: 'reason is required' });

    const log = createLogger(CAT.chat);

    try {
      setReaction(messageId, userId, 'down', reason.trim());
      softDeleteMessage(messageId);

      const ua = event.request.headers.get('user-agent') ?? 'unknown';
      const ip = getClientIP(event);
      const country = lookupCountry(ip);
      callWebhook({
        type: 'reportMessage',
        messageId,
        reason: reason.trim(),
        userAgent: ua,
        country: country ?? undefined,
      }).catch(() => {});

      return { success: true };
    } catch (err) {
      log.error`Failed to report message: ${err}`;
      return fail(500, { error: 'Internal server error' });
    }
  },

  abort: async (event) => {
    try {
      const chatId = event.params.id;
      if (!chatId) return fail(400, { error: 'chatId required' });

      const aborted = abortGeneration(chatId);
      log.info`Abort generation for chat ${chatId}: ${aborted}`;

      return { success: true, aborted };
    } catch (e) {
      log.error`Abort action failed for chat ${event.params.id}: ${e}`;
      return fail(500, { error: 'An unexpected error occurred' });
    }
  },
};

export const load: PageServerLoad = async ({ params }) => {
  const chatId = params.id;
  if (!chatId) {
    log.warn('Chat page load with missing chatId');
    error(400, 'chatId required');
  }
  const chat = getChat(chatId);
  if (!chat) {
    log.warn('Chat not found on page load', { chatId });
    error(404, 'This chat is no longer available.');
  }

  try {
    log.info('Chat page loaded', { chatId });
    const storedMessages = getMessages(chatId, 50, 0);
    // Batch fetch tool calls for all messages
    const messageIds = storedMessages.map((m) => m.id);
    const toolCallsByMessage = getToolCallsForMessages(messageIds);
    const messages = storedMessages.map((m) => ({
      id: m.id,
      role: m.role === 'system' ? 'assistant' : m.role === 'user' ? 'user' : 'assistant',
      text: m.content || '',
      sources: m.sources
        ? (() => {
            try {
              return JSON.parse(m.sources);
            } catch {
              return undefined;
            }
          })()
        : undefined,
      reasoning: m.reasoning || undefined,
      error: m.error || undefined,
      irrecoverable: m.irrecoverable || undefined,
      queryType: m.queryType || undefined,
      timestamp: new Date(m.createdAt).getTime() || Date.now(),
      createdAt: m.createdAt,
      modelId: m.modelId || 0,
      tokensIn: m.tokensIn || 0,
      tokensOut: m.tokensOut || 0,
      durationMs: m.durationMs || 0,
      deletedAt: m.deletedAt || undefined,
      toolCalls: toolCallsByMessage[m.id] || [],
    }));
    return { messages, locked: chat.locked, chatOwnerId: chat.userId };
  } catch (e) {
    log.error`Failed to load messages for chat ${chatId}: ${e}`;
    return { messages: [], locked: false, chatOwnerId: null };
  }
};
