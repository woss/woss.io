import { config } from './config';
import { CAT, createLogger } from '$lib/server/logger';

const log = createLogger(CAT.api);

export enum webhooksEnum {
  reportGenericMessage,
  reportMessage,
  messageDownvote,
  messageHeart,
  messageUpvote,
  reactionRemoved,
  chatLocked,
  chatDeleted,
  contactSubmitted,
}

interface WebhookData {
  type: keyof typeof webhooksEnum;
  chatId?: string;
  messageId?: string;
  reason?: string;
  userAgent?: string;
  country?: string;
}

export async function callWebhook(data: WebhookData): Promise<void> {
  log.info('Webhook called', { type: data.type, chatId: data.chatId });

  const url = config().report.webhookUrl;
  if (!url) return;

  const message =
    `Webhook event: ${data.type}` +
    (data.chatId ? `,\nchatId: ${data.chatId}` : '') +
    (data.messageId ? `,\nmessageId: ${data.messageId}` : '') +
    (data.reason ? `,\nreason: ${data.reason}` : '') +
    (data.userAgent ? `,\nuserAgent: ${data.userAgent}` : '') +
    (data.country ? `,\ncountry: ${data.country}` : '');
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config().report.webhookToken,
      },
      body: JSON.stringify({
        message,
        type: data.type,
        ...(data.userAgent && { userAgent: data.userAgent }),
        ...(data.country && { country: data.country }),
      }),
    });
    const text = await response.text();
    let result: unknown;
    try {
      result = JSON.parse(text);
    } catch {
      result = text;
    }
    log.info('Webhook response', { type: data.type, status: response.status, result });
  } catch (error) {
    log.error('Webhook failed', { type: data.type, error: error instanceof Error ? error.message : String(error) });
  }
}

export interface ErrorWebhookPayload {
  error: string;
  userId: string;
  chatId: string;
  model: string;
  provider: string;
  status: number;
}

export async function callErrorWebhook(payload: ErrorWebhookPayload): Promise<void> {
  const url = config().report.errorWebhookUrl;
  if (!url) return;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      log.error('Error webhook returned non-ok status', { status: res.status, body: text });
    } else {
      log.info('Error webhook succeeded', { status: res.status });
    }
  } catch (err) {
    log.error('Error webhook request failed', { error: err instanceof Error ? err.message : String(err) });
  }
}
