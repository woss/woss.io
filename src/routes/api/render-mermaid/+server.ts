import type { RequestEvent } from '@sveltejs/kit';
import { CAT, createLogger } from '$lib/server/logger';

import { env } from '$env/dynamic/private';

const log = createLogger(CAT.chat);

const MERMAID_API_KEY = env.MERMAID_API_KEY || '';
const MERMAID_RENDER_BASE_URL = env.MERMAID_RENDER_BASE_URL || 'http://mermaid:8080';
const MERMAID_RENDER_URL = `${MERMAID_RENDER_BASE_URL}/convert/svg`;

export async function POST(event: RequestEvent): Promise<Response> {
  const start = Date.now();
  try {
    const body = await event.request.json();
    const code: string | undefined = body?.mermaid ?? body?.code;
    const codeLen = code?.length ?? 0;

    log.info`render-mermaid: request received, code=${codeLen} chars, url=${MERMAID_RENDER_URL}`;

    if (!code || typeof code !== 'string') {
      log.warning`render-mermaid: 400 code field missing`;
      return new Response(JSON.stringify({ error: 'code field required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (code.length > 50000) {
      log.warning`render-mermaid: 413 code too long (${code.length})`;
      return new Response(JSON.stringify({ error: 'code too long' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    let response: Response;
    try {
      log.info`render-mermaid: POST ${MERMAID_RENDER_URL}`;
      response = await fetch(MERMAID_RENDER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(MERMAID_API_KEY ? { 'X-API-Key': MERMAID_API_KEY } : {}),
        },
        body: JSON.stringify({ mermaid: code }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const respTime = Date.now() - start;

    if (!response.ok) {
      const text = await response.text();
      log.error`render-mermaid: mermaid service returned ${response.status} in ${respTime}ms: ${text}`;
      return new Response(JSON.stringify({ error: 'Render service error' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const svgText = await response.text();

    if (!svgText || svgText.trim().length === 0) {
      log.warning`render-mermaid: mermaid service returned empty SVG in ${respTime}ms`;
      return new Response(JSON.stringify({ error: 'Render service returned empty SVG' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    log.info`render-mermaid: success, SVG=${svgText.length} chars in ${respTime}ms`;
    return new Response(JSON.stringify({ svg: svgText }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err) {
    const elapsed = Date.now() - start;
    log.error`render-mermaid: proxy error after ${elapsed}ms: ${err}`;
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
