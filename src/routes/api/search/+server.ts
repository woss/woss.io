import { searchChunks } from '$lib/server/db';
import { embedText } from '$lib/server/embed';
import { isAvailable } from '$lib/server/openai-provider';
import { checkRateLimit } from '$lib/server/rate-limiter';
import { CAT, createLogger } from '$lib/server/logger';
import type { RequestEvent } from '@sveltejs/kit';

const log = createLogger(CAT.search);

/** Chunk shape returned to client — excludes embedding vector. */
interface ChunkResponse {
  id: string;
  text: string;
  title: string;
  date: string | null;
  tags: string[];
  section: string;
}

/** Single ranked result returned to client. */
interface ResultResponse {
  chunk: ChunkResponse;
  score: number;
}

function jsonHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };
}

function errorBody(message: string): string {
  return JSON.stringify({ error: message, results: [] });
}

export async function GET(event: RequestEvent): Promise<Response> {
  const rawQuery = event.url.searchParams.get('q') ?? '';

  // Guard: empty query
  if (!rawQuery) {
    return new Response(errorBody("Query parameter 'q' is required"), {
      status: 400,
      headers: jsonHeaders(),
    });
  }

  // Guard: rate limit
  const ip = event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? event.getClientAddress();
  const limit = checkRateLimit(ip);
  if (!limit.allowed) {
    const retryAfter = Math.ceil((limit.resetAt - Date.now()) / 1000);
    return new Response(
      JSON.stringify({
        error: 'Rate limit exceeded',
        resetAt: limit.resetAt,
        results: [],
      }),
      {
        status: 429,
        headers: {
          ...jsonHeaders(),
          'Retry-After': String(retryAfter),
        },
      },
    );
  }

  // Parse optional type filter
  const typeParam = event.url.searchParams.get('type') ?? '';
  const typeFilter = typeParam === 'post' || typeParam === 'experience' ? typeParam : undefined;

  log.info('Search request', { query: rawQuery, type: typeParam, ip });

  // Parse query: strip HTML tags, trim whitespace, cap at 200 characters
  const sanitized = rawQuery
    .replace(/<[^>]*>/g, '')
    .trim()
    .slice(0, 200);

  // Guard: empty after sanitization
  if (!sanitized) {
    log.warn('Search query empty after sanitization', { rawQuery, ip });
    return new Response(errorBody("Query parameter 'q' is required"), {
      status: 400,
      headers: jsonHeaders(),
    });
  }

  // Guard: AI service unreachable
  if (!(await isAvailable())) {
    log.error('Search unavailable — AI service not reachable', { ip });
    return new Response(errorBody('Search unavailable — AI service not reachable'), {
      status: 503,
      headers: jsonHeaders(),
    });
  }

  // Embed query and search vector database
  const embedding = await embedText(sanitized);
  const dbResults = searchChunks(embedding.data, 216, typeFilter);

  // Filter by similarity threshold, strip internal fields
  const results: ResultResponse[] = dbResults
    .filter((r) => r.score < 1.5)
    .map((r) => ({
      chunk: {
        id: r.chunk.id,
        text: r.chunk.text,
        title: r.chunk.title,
        date: r.chunk.date,
        tags: r.chunk.tags,
        section: r.chunk.section,
      },
      score: r.score,
    }));

  log.info('Search results', { query: sanitized, resultCount: results.length, ip });

  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: jsonHeaders(),
  });
}
