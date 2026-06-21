import { dismissFeatureTours } from '$lib/server/db';
import type { RequestEvent } from '@sveltejs/kit';

export async function POST(event: RequestEvent): Promise<Response> {
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
    dismissFeatureTours(userId, featureIds);
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
