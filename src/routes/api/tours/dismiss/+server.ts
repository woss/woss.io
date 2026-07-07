import { db } from '$lib/server/db';
import { checkRateLimit } from '$lib/server/rate-limiter';
import type { RequestEvent } from '@sveltejs/kit';

export async function POST(event: RequestEvent): Promise<Response> {
  const ip = event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? event.getClientAddress();
  const rateCheck = await checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after': String(Math.ceil((rateCheck.resetAt - Date.now()) / 1000)),
      },
    });
  }
  let body: { userId?: string; featureIds?: string[] };
  try {
    body = await event.request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = String(body.userId ?? '');
  const featureIds = Array.isArray(body.featureIds) ? body.featureIds : [];

  if (!userId || featureIds.length === 0) {
    return new Response(JSON.stringify({ error: 'userId and featureIds are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await db.featureTours.dismissFeatureTours(userId, featureIds);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
