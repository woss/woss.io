/**
 * Client-safe config (public env vars only).
 * Available from both client and server code.
 */
import { env } from '$env/dynamic/public';

export const config = {
  get public() {
    return {
      maxMessages: Number(env.PUBLIC_MAX_MESSAGES) || 10,
      maxChats: Number(env.PUBLIC_MAX_CHATS) || 3,
    };
  },
} as const;
