import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import { createChat, getUserChatCount, getOrCreateUserAgent } from '$lib/server/db';
import { config as clientConfig } from '$lib/config';
import { CAT, createLogger } from '$lib/server/logger';

const log = createLogger(CAT.chat);

function getClientIP(event: import('@sveltejs/kit').RequestEvent): string {
  return event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? event.getClientAddress();
}

export const actions: Actions = {
  create: async (event) => {
    try {
      const fd = await event.request.formData();
      const userId = fd.get('userId')?.toString();
      if (!userId) return fail(400, { error: 'userId is required' });

      const chatCount = getUserChatCount(userId);
      if (chatCount >= clientConfig.public.maxChats) {
        log.warn`Create chat rejected: user ${userId} has ${chatCount} chats (max ${clientConfig.public.maxChats})`;
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
};
