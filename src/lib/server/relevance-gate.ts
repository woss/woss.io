import { config } from '$lib/server/config';
import { getRelevanceGateInstructions } from './prompts';
import { CAT, createLogger } from '$lib/server/logger';

const log = createLogger(CAT.chat);

/** Shape of the Jev System One response we consume. Unknown fields ignored. */
interface JevSystemOneResponse {
  answers?: {
    is_relevant?: { type?: string; noul?: unknown };
  };
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Binary relevance check via the Jev System One `noul` evaluation.
 * Returns P(true) >= threshold (relevant). Throws on any failure —
 * caller (isRelevant) owns the fail-open policy.
 */
export async function jevRelevanceCheck(
  question: string,
  context: string | undefined,
  signal?: AbortSignal,
): Promise<boolean> {
  const { relevanceGate, apiKey } = config().openai;

  const body = {
    model: relevanceGate.model,
    state: {
      message: question,
      ...(context ? { recent_history: context } : {}),
    },
    questions: {
      is_relevant: {
        type: 'noul',
        instructions: getRelevanceGateInstructions(),
        criteria: {
          true: "About Daniel Maricic's professional portfolio, skills, projects, career, or polite conversation with his assistant",
          false: 'Unrelated topic (politics, sports, weather, generic coding help, etc.)',
        },
      },
    },
  };

  const response = await fetch(relevanceGate.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(5000),
  });
  log.info`🔍 isRelevant provider=jev HTTP status: ${response.status}`;
  if (!response.ok) {
    throw new Error(`jev HTTP ${response.status}`);
  }

  const parsed = (await response.json()) as JevSystemOneResponse;
  log.info((l) => l`🔍 isRelevant provider=jev raw response body: ${JSON.stringify(parsed)}`);

  const noul = parsed.answers?.is_relevant?.noul;
  if (typeof noul !== 'number' || !Number.isFinite(noul)) {
    throw new Error(`jev missing/malformed answers.is_relevant.noul: ${JSON.stringify(noul)}`);
  }
  const usage = parsed.usage;
  log.info`🔍 isRelevant provider=jev noul=${noul} threshold=${relevanceGate.threshold} tokens=${usage?.input_tokens}/${usage?.output_tokens}`;

  return noul >= relevanceGate.threshold;
}
