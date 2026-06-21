import { config } from '$lib/server/config';
import { CAT, createLogger } from '$lib/server/logger';
import { getToolClassifierUserPrompt, getToolClassifierSystemPrompt } from '../prompts.ts';
import { parseToolClass } from '$lib/server/chat-helpers';

/** Shape of a chat-completion API response. */
interface ChatCompletionResponse {
  choices?: { message?: { content?: string; reasoning_content?: string } }[];
}

const log = createLogger(CAT.chat);

/**
 * LLM-based tool-needs classifier for short ambiguous follow-ups like 'yup do it' or '3 more?'.
 * Keyword-based checks can't determine intent for these, so we ask the LLM what tools are needed.
 *
 * Returns 'none' | 'github' | 'macula' | 'both'. Fail-safe: returns 'none' on any error/timeout
 * so tools are never mis-enabled. Only called in handleEarlyGates when keyword checks are
 * inconclusive AND text is short (≤6 words).
 *
 * DeepSeek-backed models put the answer in reasoning_content rather than content,
 * so we also extract the keyword via regex from verbose responses as a fallback.
 */
export async function classifyToolNeeds(
  question: string,
  history: { role: string; content: string }[],
  signal?: AbortSignal,
): Promise<'none' | 'github' | 'macula' | 'both'> {
  const context = history
    .slice(-2)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  try {
    const content = getToolClassifierUserPrompt(question, context || undefined);
    log.info`🔍 classifyToolNeeds prompt:\n${content}`;
    const response = await fetch(`${config().openai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config().openai.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config().openai.toolClassifyModel ?? config().openai.model,
        provider: { reasoning_type: 'hidden' },
        extra_body: { reasoning_effort: 'none' },
        messages: [
          {
            role: 'system',
            content: getToolClassifierSystemPrompt(),
          },
          {
            role: 'user',
            content,
          },
        ],
        temperature: 0,
        max_tokens: 500,
      }),
      signal: signal ?? AbortSignal.timeout(config().openai.toolClassifyTimeoutMs),
    });
    log.info`🔍 classifyToolNeeds HTTP status: ${response.status}`;
    if (!response.ok) {
      log.warn`Tool-needs check HTTP ${response.status} — returning none (fail-safe)`;
      return 'none';
    }

    const body = (await response.json()) as ChatCompletionResponse;
    const msg = body.choices?.[0]?.message;
    const rawAnswer = (msg?.content || msg?.reasoning_content || '').trim().toLowerCase();
    log.info((l) => l`🔍 classifyToolNeeds raw response body: ${JSON.stringify(body)}`);
    log.info`🔍 classifyToolNeeds answer="${rawAnswer}"`;
    // Direct match — model put the keyword in content
    if (rawAnswer === 'github' || rawAnswer === 'macula' || rawAnswer === 'both' || rawAnswer === 'none')
      return rawAnswer;
    // Fallback: search reasoning content for classification keyword
    // DeepSeek puts reasoning in reasoning_content, answer may be buried mid-text
    if (rawAnswer.length > 10) {
      const matches = [...rawAnswer.matchAll(/\b(github|macula|both|none)\b/g)];
      // Filter out negated keywords (e.g., "not a GitHub or macula operation")
      const nonNegated = matches.filter((m) => {
        const before = rawAnswer.slice(Math.max(0, m.index! - 40), m.index!);
        return !/\bnot\s/i.test(before);
      });
      const keyword = nonNegated[nonNegated.length - 1];
      if (keyword) {
        log.info`🔍 classifyToolNeeds: extracted "${keyword[1]}" from reasoning content`;
        return parseToolClass(keyword[1]);
      }
    }
    log.info`🔍 classifyToolNeeds: answer not recognized, returning none`;
    return 'none';
  } catch (err) {
    log.warn`Tool-needs check failed: ${err} — returning none (fail-safe)`;
    return 'none';
  }
}
