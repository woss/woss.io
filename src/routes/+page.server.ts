import { fail } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getPosts, createChat, getChat, deleteChat, getUserChatCount, getOrCreateUserAgent } from '$lib/server/db';
import { callWebhook } from '$lib/server/webhooks';
import { CAT, createLogger } from '$lib/server/logger';
import { config } from '$lib/config';

export async function load() {
  const allPosts = getPosts();

  const heroPage = allPosts.find((p) => p.slug === 'building-woss-io');
  const hero = heroPage
    ? {
        title: heroPage.title || '',
        description: heroPage.description || '',
        slug: heroPage.slug,
      }
    : null;

  const featuredPosts = allPosts
    .filter((p) => p.featured)
    .map((p) => ({
      slug: p.slug,
      title: p.title || p.slug,
      description: p.description || '',
      date: p.date || '',
      tags: p.tags,
      headerImage: p.headerImage ?? null,
    }));

  return { hero, featuredPosts };
}

const log = createLogger(CAT.app);

export const actions = {
  create: async (event: RequestEvent) => {
    const { request } = event;

    const data = await request.formData();
    const userId = data.get('userId')?.toString();

    if (!userId) return fail(400, { error: 'userId is required' });

    const count = getUserChatCount(userId);
    if (count >= config.public.maxChats) {
      return fail(400, { error: `Maximum ${config.public.maxChats} chats allowed` });
    }

    try {
      const ip = event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? event.getClientAddress();
      const userAgent = event.request.headers.get('user-agent');
      const userAgentId = userAgent ? getOrCreateUserAgent(userAgent, ip) : undefined;
      const id = createChat(userId, undefined, userAgentId);
      return { id };
    } catch (e) {
      log.error`Failed to create chat: ${e}`;
      return fail(500, { error: 'Failed to create chat' });
    }
  },

  delete: async (event: RequestEvent) => {
    const { request } = event;

    const data = await request.formData();
    const userId = data.get('userId')?.toString();
    const chatId = data.get('chatId')?.toString();

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
