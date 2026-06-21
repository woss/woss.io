import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { config } from '$lib/server/config.js';
import { CAT, createLogger } from '$lib/server/logger.js';
const log = createLogger(CAT.llm);

/**
 * Creates a TransformStream that rewrites finish_reason in SSE responses.
 * DeepSeek / Cloudflare Workers AI emit `finish_reason: "stop"` instead of
 * `"tool_calls"` when tool calls were made in the response. This causes the
 * AI SDK's maxSteps loop to stop prematurely, preventing the model from
 * writing an answer after calling a tool.
 *
 * The transform tracks whether any `tool_calls` deltas appeared in the SSE
 * stream. When `finish_reason: "stop"` is encountered and tool calls were
 * seen, it rewrites the finish_reason to `"tool_calls"` so the SDK correctly
 * continues to the next step.
 */
function fixFinishReasonTransform(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  let sawToolCalls = false;

  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = buffer.endsWith('\n') ? '' : (lines.pop() ?? '');

      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const parsed = JSON.parse(line.slice(6));
            const choice = parsed.choices?.[0];
            if (choice) {
              if (choice.delta?.tool_calls) {
                sawToolCalls = true;
              }
              if (choice.finish_reason === 'stop' && sawToolCalls) {
                choice.finish_reason = 'tool_calls';
                sawToolCalls = false;
                controller.enqueue(encoder.encode('data: ' + JSON.stringify(parsed) + '\n'));
                continue;
              }
            }
          } catch (e) {
            log.warn`Failed to parse LLM streaming JSON chunk: ${e}`;
          }
        }
        controller.enqueue(encoder.encode(line + '\n'));
      }
    },
    flush(controller) {
      if (buffer) {
        controller.enqueue(encoder.encode(buffer + '\n'));
      }
    },
  });
}

/**
 * Custom fetch function that:
 * 1. Pipes SSE responses through the finish_reason fix transform
 * 2. Short-circuits 429 rate limit as 400 to skip AI SDK's internal retry loop
 */
async function customFetch(input: string | URL | globalThis.Request, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);

  // Short-circuit 429 rate limit → 400 to prevent AI SDK's 3 internal retries.
  // The SDK only retries on 429/5xx; a 400 passes through immediately.
  if (response.status === 429) {
    const body = await response.text();
    if (body.includes('Rate limit') || body.includes('FreeUsageLimitError')) {
      log.warn`Rate limit 429 detected, mapping to 400 to skip SDK internal retries`;
      return new Response(body, {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  // Log rate limit headers for debugging and monitoring
  const remaining = response.headers.get('x-ratelimit-remaining');
  const reset = response.headers.get('x-ratelimit-reset');
  const limit = response.headers.get('x-ratelimit-limit');
  const retryAfter = response.headers.get('retry-after');
  if (remaining || reset || limit || retryAfter) {
    log.debug`Rate limit headers: remaining=${remaining} reset=${reset} limit=${limit} retry-after=${retryAfter}`;
  }

  // Log all headers on error responses for discovery
  if (!response.ok) {
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    log.debug`LLM API error ${response.status}: headers=${JSON.stringify(headers)}`;
  }

  if (!response.body) return response;

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/event-stream')) return response;

  const transformedStream = response.body.pipeThrough(fixFinishReasonTransform());

  return new Response(transformedStream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export const provider = createOpenAICompatible({
  name: 'provider',
  baseURL: config().openai.baseUrl,
  apiKey: config().openai.apiKey,
  fetch: customFetch,
});

export const modelName = config().openai.model;
