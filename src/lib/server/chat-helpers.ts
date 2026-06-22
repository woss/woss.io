import { getChat, renameChat } from '$lib/server/db';
import { config } from '$lib/server/config';
import {
  getRelevanceCheckUserPrompt,
  getRelevanceCheckSystemPrompt,
  getPoliteResponseSystemPrompt,
} from './prompts.ts';
import { CAT, createLogger } from '$lib/server/logger';

/** Shape of a chat-completion API response. */
interface ChatCompletionResponse {
  choices?: { message?: { content?: string; reasoning_content?: string } }[];
}

/** Source info parsed from JSON storage. */
interface RawSource {
  title: string;
  score: number;
  slug?: string;
  url?: string;
}

const log = createLogger(CAT.chat);

/**
 * Auto-rename "New Chat" to the user's first message (truncated to 40 chars).
 * Best-effort — failures are logged but never surface to the user.
 */
export function tryRenameChat(chatId: string, text: string): void {
  try {
    const chat = getChat(chatId);
    if (chat && chat.title === 'New Chat') renameChat(chatId, text.slice(0, 40));
  } catch (err) {
    log.error`auto-rename failed: ${err}`;
  }
}

/**
 * Keyword-based check: does the message need GitHub MCP tools?
 * Fast path (no LLM call). Short ambiguous messages (≤6 words) without explicit
 * Daniel/project references fall through to the LLM-based classifyToolNeeds fallback
 * in handleEarlyGates instead of returning false immediately.
 */
export function needsGithubTools(text: string, ctxMessages?: { role: string; content: string }[]): boolean {
  const t = text.toLowerCase();
  const referencesDaniel = /\b(daniel(?:'?s)?|woss|anagolay|macula)\b/i.test(t);
  const contextReferencesDaniel =
    !referencesDaniel &&
    ctxMessages?.some(
      (m) => m.role === 'user' && /\b(daniel(?:'?s)?|woss|anagolay|macula)\b/i.test((m.content ?? '').toLowerCase()),
    );
  const hasKeyword =
    /pr|pull request|commit|issue|repo|repository|github|stars|fork|contrib|project|built|founded|work|portfolio/.test(
      t,
    );
  if (hasKeyword) return true;
  if (!referencesDaniel && !contextReferencesDaniel) {
    const wc = t.split(/\s+/).filter(Boolean).length;
    if (wc > 6) return false;
  }
  return false;
}

/**
 * Keyword-based check: does the message need Macula MCP tools (photos, media, files)?
 * Same fast-path pattern as needsGithubTools — short messages without Daniel/project
 * references fall through to classifyToolNeeds in handleEarlyGates.
 */
export function needsMaculaTools(text: string, ctxMessages?: { role: string; content: string }[]): boolean {
  const t = text.toLowerCase();
  const referencesDaniel = /\b(daniel(?:'?s)?|woss|macula)\b/i.test(t);
  const contextReferencesDaniel =
    !referencesDaniel &&
    ctxMessages?.some(
      (m) => m.role === 'user' && /\b(daniel(?:'?s)?|woss|portfolio|macula)\b/i.test((m.content ?? '').toLowerCase()),
    );
  const hasKeyword =
    /macula|image|photo|picture|video|media|file|asset|keyword|license|metadata|exif|portfolio|art|music|hobbies?|interests?|traverse|get_users|album|directory/.test(
      t,
    );
  if (hasKeyword) return true;
  if (!referencesDaniel && !contextReferencesDaniel) {
    const wc = t.split(/\s+/).filter(Boolean).length;
    if (wc > 6) return false;
  }
  return false;
}

/**
 * Fast binary relevance check via a lightweight LLM call (temperature=0, 5s timeout).
 * Is this message about Daniel Maricic's professional portfolio?
 *
 * Polite closings, gratitude, contact requests are always relevant — bypasses LLM.
 * Fail-open: returns true on any error/timeout so legitimate queries aren't blocked.
 * Slash commands and messages with tool intent skip this gate entirely.
 */
export async function isRelevant(
  question: string,
  history: { role: string; content: string }[],
  signal?: AbortSignal,
): Promise<boolean> {
  // Fast bypass for polite closings, gratitude, contact requests — always relevant
  const politePattern =
    /^(thank(s| you|you!)|thanks|cheers|ty|thx|great|awesome|perfect|got it|ok|okay|sure|nice|good|cool|that('s| is) all|that helps|bye|have a good|contact|hire|reach out|get in touch|talk to|speak with)/i;
  if (politePattern.test(question.trim())) {
    return true;
  }

  // Fast bypass for known relevant keywords — brand names, person names, assistant name
  const relevantKeywords = /\b(haistlin|woss|daniel|maricic)\b/i;
  if (relevantKeywords.test(question.trim())) {
    return true;
  }

  // Short "who" questions (≤3 words) are about the assistant (Haistlin)
  const trimmed = question.trim();
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 3 && /\bwho\b/i.test(trimmed)) {
    return true;
  }

  const context = history
    .slice(-2)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  try {
    const content = getRelevanceCheckUserPrompt(question, context || undefined);
    log.info`🔍 isRelevant prompt:\n${content}`;
    const response = await fetch(`${config().openai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config().openai.apiKey}`,
        'Content-Type': 'application/json',
      },

      body: JSON.stringify({
        model: config().openai.relevanceCheckModel ?? config().openai.model,
        // OpenRouter: hide reasoning
        provider: { reasoning_type: 'hidden' },
        // Fallback for other APIs
        extra_body: { reasoning_effort: 'none' },
        messages: [
          {
            role: 'system',
            content: getRelevanceCheckSystemPrompt(),
          },
          {
            role: 'user',
            content,
          },
        ],
        temperature: 0,
        max_tokens: 5000,
      }),
      signal: signal ?? AbortSignal.timeout(5000),
    });
    log.info`🔍 isRelevant HTTP status: ${response.status}`;
    if (!response.ok) {
      log.warn`Relevance check HTTP ${response.status} — allowing query (fail-open)`;
      return true;
    }

    const body = (await response.json()) as ChatCompletionResponse;
    log.info((l) => l`🔍 isRelevant raw response body: ${JSON.stringify(body)}`);
    const msg = body.choices?.[0]?.message;
    const answer = (msg?.content || msg?.reasoning_content || '').trim().toLowerCase();
    log.info`🔍 isRelevant answer="${answer}"`;
    return answer === 'yes';
  } catch (err) {
    log.warn`Relevance check failed: ${err} — allowing query (fail-open)`;
    return true;
  }
}

/**
 * Generate a warm natural-language response for polite-only messages (thanks, positive feedback).
 * No RAG, no tools, no portfolio info — just a friendly 1-2 sentence reply.
 * Used by handleEarlyGates polite-only path. Falls back to a hardcoded string if this fails.
 */
export async function generatePoliteResponse(message: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(`${config().openai.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config().openai.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config().openai.model,
      provider: { reasoning_type: 'hidden' },
      extra_body: { reasoning_effort: 'none' },
      messages: [
        {
          role: 'system',
          content: getPoliteResponseSystemPrompt(),
        },
        { role: 'user', content: message },
      ],
      temperature: 0.7,
      max_tokens: 100,
    }),
    signal: signal ?? AbortSignal.timeout(5000),
  });
  log.info`🔍 generatePoliteResponse HTTP status: ${response.status}`;
  if (!response.ok) {
    log.warn`generatePoliteResponse HTTP ${response.status} — throwing`;
    throw new Error(`HTTP ${response.status}`);
  }
  const body = (await response.json()) as ChatCompletionResponse;
  log.info((l) => l`🔍 generatePoliteResponse raw response body: ${JSON.stringify(body)}`);
  const msg = body.choices?.[0]?.message;
  const ans = (msg?.content || msg?.reasoning_content || '').trim();
  log.info`🔍 generatePoliteResponse answer="${ans}"`;
  return ans;
}

/**
 * Parse a tool classification string into the union type.
 * Invalid values fall back to 'none'.
 */
export function parseToolClass(value: string): 'none' | 'github' | 'macula' | 'both' {
  if (value === 'github' || value === 'macula' || value === 'both' || value === 'none') return value;
  return 'none';
}

/**
 * Parse a sources JSON string into a typed array.
 * Malformed JSON or non-arrays return [].
 */
export function parseSources(json: string): RawSource[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item: unknown) => {
      if (typeof item !== 'object' || item === null) return { title: '', score: 0 };
      const src = item as Record<string, unknown>;
      return {
        title: typeof src.title === 'string' ? src.title : '',
        score: typeof src.score === 'number' ? src.score : 0,
        slug: typeof src.slug === 'string' ? src.slug : undefined,
        url: typeof src.url === 'string' ? src.url : undefined,
      };
    });
  } catch (e) {
    log.warn`Failed to parse sources JSON: ${e}`;
    return [];
  }
}
