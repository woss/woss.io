import type { ChatMessage } from './types.ts';
import { randomUUID } from '$lib/utils/random-uuid';

export interface SendResult {
  messages: ChatMessage[];
  /** Error message if the API call failed */
  error?: string;
  /** true if the API accepted the request (202), meaning SSE will handle streaming */
  accepted: boolean;
  /** true if the chat was rejected because it's locked */
  locked?: boolean;
}

/**
 * Sends a chat message via form action.
 * Returns updated messages array and status.
 * Does NOT handle UI state (loading, input clearing, scroll position).
 */
export async function sendChatMessage(
  text: string,
  userId: string,
  chatId: string,
  currentMessages: ChatMessage[],
): Promise<SendResult> {
  const trimmed = text.trim();
  const timestamp = Date.now();
  if (!trimmed) return { messages: currentMessages, error: 'Message cannot be empty', accepted: false };

  const updatedMessages: ChatMessage[] = [
    ...currentMessages,
    {
      id: randomUUID(),
      role: 'user',
      text: trimmed,
      timestamp,
      createdAt: new Date().toISOString(),
    },
    {
      id: randomUUID(),
      role: 'assistant',
      text: '',
      timestamp: timestamp + 1,
      createdAt: new Date().toISOString(),
    },
  ];

  try {
    const fd = new FormData();
    fd.set('text', trimmed);
    fd.set('userId', userId);
    fd.set('maxChunks', '8');

    const response = await fetch(`/chat/${chatId}?/ask`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: fd,
    });

    const body = await response.json().catch(() => ({}));

    if (body.type === 'failure') {
      const error = body.data?.error || `Server error: ${response.status}`;
      const lastIdx = updatedMessages.length - 1;
      updatedMessages[lastIdx] = { ...updatedMessages[lastIdx], error };
      return { messages: updatedMessages, error, accepted: false, locked: body.data?.locked === true };
    }

    if (!response.ok) {
      const error = `Server error: ${response.status}`;
      const lastIdx = updatedMessages.length - 1;
      updatedMessages[lastIdx] = { ...updatedMessages[lastIdx], error };
      return { messages: updatedMessages, error, accepted: false };
    }

    return { messages: updatedMessages, accepted: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Network error. Please try again.';
    const lastIdx = updatedMessages.length - 1;
    updatedMessages[lastIdx] = { ...updatedMessages[lastIdx], error };
    return { messages: updatedMessages, error, accepted: false };
  }
}
