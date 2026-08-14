import { context, trace, SpanStatusCode } from '@opentelemetry/api';
import type { Context, Span } from '@opentelemetry/api';

/**
 * Resolve the application tracer from the global provider.
 *
 * Resolved lazily on every call (never captured at module scope) so the spans
 * bind to whatever provider `instrumentation.server.ts` has registered by the
 * time the helper actually runs — independent of module load order. When the
 * OTEL SDK is disabled (`OTEL_SDK_DISABLED=1`) the API returns a no-op tracer,
 * so calling these helpers is always safe and cheap.
 */
function tracer() {
  return trace.getTracer('woss');
}

/**
 * Wrap an async operation in a child span.
 *
 * Starts a span named `name` as a child of the active context, runs `fn`
 * inside it, records success/error, then ends the span and restores the
 * previous context. On throw the span is marked ERROR, the exception
 * recorded, and the error re-thrown.
 *
 * Use around discrete work that should appear as its own segment in Datadog
 * traces (RAG search, LLM streaming, tool calls, result persistence).
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const span = tracer().startSpan(name, { attributes });
  const ctx = trace.setSpan(context.active(), span);
  return context.with(ctx, async () => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Run an async callback in an explicit context (e.g. a manually created root
 * span from `createRootSpan`). Keeps `fn`'s spans as children of `ctx`.
 */
export function withContext<T>(ctx: Context, fn: () => Promise<T>): Promise<T> {
  return context.with(ctx, () => fn());
}

/**
 * Create a root span (no parent) for background work that runs outside any
 * request context — e.g. the fire-and-forget generation pipeline.
 */
export function createRootSpan(name: string, attributes?: Record<string, string | number | boolean | undefined>): Span {
  return tracer().startSpan(name, { attributes });
}

/** End a span, marking ERROR + recording the exception on failure. */
export function endSpan(span: Span, error?: unknown): void {
  if (error !== undefined) {
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.recordException(error instanceof Error ? error : new Error(String(error)));
  }
  span.end();
}
