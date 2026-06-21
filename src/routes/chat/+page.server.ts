import { fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createChat, getChats, getUserChatCount, getOrCreateUserAgent, getChat, deleteChat } from '$lib/server/db';
import { callWebhook } from '$lib/server/webhooks';
import { config as clientConfig } from '$lib/config';
import { CAT, createLogger } from '$lib/server/logger';

const log = createLogger(CAT.chat);

function getClientIP(event: import('@sveltejs/kit').RequestEvent): string {
  return event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? event.getClientAddress();
}

export const load: PageServerLoad = async ({ url }) => {
  const userId = url.searchParams.get('userId');
  if (!userId) return { chats: [] };

  const chats = getChats(userId);
  return { chats };
};

export const actions: Actions = {
  create: async (event) => {
    try {
      const fd = await event.request.formData();
      const userId = fd.get('userId')?.toString();
      if (!userId) return fail(400, { error: 'userId is required' });

      const chatCount = getUserChatCount(userId);
      if (chatCount >= clientConfig.public.maxChats) {
        return fail(400, { error: `Maximum of ${clientConfig.public.maxChats} chats reached` });
      }

      const ip = getClientIP(event);
      const userAgentStr = event.request.headers.get('user-agent');
      const userAgentId = userAgentStr ? getOrCreateUserAgent(userAgentStr, ip) : undefined;

      const id = createChat(userId, undefined, userAgentId);
      log.debug`Created chat ${id} for user ${userId}`;

      return { id };
    } catch (e) {
      log.error`Failed to create chat: ${e}`;
      return fail(500, { error: 'Failed to create chat' });
    }
  },

  delete: async (event) => {
    const fd = await event.request.formData();
    const userId = fd.get('userId')?.toString();
    const chatId = fd.get('chatId')?.toString();
    if (!userId) return fail(400, { error: 'userId is required' });
    if (!chatId) return fail(400, { error: 'chatId is required' });
    try {
      const chat = getChat(chatId);
      if (!chat) return fail(404, { error: 'Chat not found' });
      if (chat.userId !== userId) return fail(403, { error: 'Forbidden' });
      deleteChat(chatId);
      callWebhook({ type: 'chatDeleted', chatId }).catch((e) => log.warn`Webhook failed: ${e}`);
      return { success: true, chatId };
    } catch (e) {
      log.error`Failed to delete chat: ${e}`;
      return fail(500, { error: 'Failed to delete chat' });
    }
  },
};
