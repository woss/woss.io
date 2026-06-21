import { insertChatEvent } from './db.ts';
import { CAT, createLogger } from '$lib/server/logger';

const log = createLogger(CAT.chat);

export interface ChatEventPayload {
  id: number;
  chatId: string;
  type: string;
  data: unknown;
}

type Subscriber = (event: ChatEventPayload) => void;

const subscribers = new Map<string, Set<Subscriber>>();

/**
 * Subscribe to real-time events for a chat.
 * Returns an unsubscribe function.
 */
export function subscribe(chatId: string, cb: Subscriber): () => void {
  if (!subscribers.has(chatId)) subscribers.set(chatId, new Set());
  subscribers.get(chatId)!.add(cb);
  return () => {
    subscribers.get(chatId)?.delete(cb);
  };
}

/**
 * Publish an event to a chat's subscribers (in-memory only).
 * Does NOT persist to DB. For live streaming only.
 */
export function publishLive(chatId: string, type: string, data: unknown): void {
  const event: ChatEventPayload = { id: 0, chatId, type, data };
  subscribers.get(chatId)?.forEach((cb) => {
    try {
      cb(event);
    } catch {
      log.error('Live subscriber callback failed', { chatId, type });
    }
  });
}

/**
 * Publish an event and persist to DB.
 * Returns the event ID from DB.
 */
export function publishPersistent(chatId: string, type: string, data: unknown): number {
  const id = insertChatEvent(chatId, type, data);
  const event: ChatEventPayload = { id, chatId, type, data };
  subscribers.get(chatId)?.forEach((cb) => {
    try {
      cb(event);
    } catch {
      log.error('Persistent subscriber callback failed', { chatId, type });
    }
  });
  return id;
}
