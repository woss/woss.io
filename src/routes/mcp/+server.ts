import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { mcpServer } from '$lib/server/mcp-server';
import { checkRateLimit } from '$lib/server/rate-limiter';
import { CAT, createLogger } from '$lib/server/logger';
import type { RequestEvent } from '@sveltejs/kit';

const log = createLogger(CAT.mcp);

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function getClientIP(event: RequestEvent): string {
  return event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? event.getClientAddress();
}

export async function POST(event: RequestEvent): Promise<Response> {
  const userAgent = event.request.headers.get('user-agent') ?? 'unknown';
  log.info`MCP POST ${getClientIP(event)} UA=${userAgent}`;
  // Rate limit
  const ip = getClientIP(event);
  const limit = await checkRateLimit(ip);
  if (!limit.allowed) {
    const retryAfter = Math.ceil((limit.resetAt - Date.now()) / 1000);
    return new Response('Rate limit exceeded', {
      status: 429,
      headers: { 'Retry-After': String(Math.max(1, retryAfter)), ...CORS_HEADERS },
    });
  }

  try {
    // Normalize Accept header — transport requires both application/json and text/event-stream
    const accept = event.request.headers.get('accept') || '';
    const headers = new Headers(event.request.headers);
    if (!accept.includes('text/event-stream')) {
      headers.set('accept', accept ? `${accept}, text/event-stream` : 'application/json, text/event-stream');
    }
    const normalizedRequest = new Request(event.request.url, {
      method: event.request.method,
      headers,
      body: event.request.body,
      // @ts-expect-error - duplex required for streaming request body
      duplex: 'half',
    });

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless — no session reuse
    });
    // Close any prior connection before re-binding
    try {
      await mcpServer.close();
    } catch {
      /* first call — no prior transport */
    }
    await mcpServer.connect(transport);
    const response = await transport.handleRequest(normalizedRequest);
    // Spread CORS headers onto the transport response
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      response.headers.set(key, value);
    }
    return response;
  } catch (err) {
    log.error`MCP transport error: ${err}`;
    return new Response('Internal server error', {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
}

export async function GET(): Promise<Response> {
  return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
}

export async function DELETE(): Promise<Response> {
  return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
