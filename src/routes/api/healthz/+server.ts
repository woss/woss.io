import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import type { RequestEvent } from '@sveltejs/kit';

export async function GET(event: RequestEvent) {
  const ip = event.getClientAddress();
  if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
    return new Response('Not found', { status: 404 });
  }
  try {
    const healthy = await db.healthCheck();
    if (!healthy) {
      return json({ status: 'error', db: 'SurrealDB health check failed' }, { status: 503 });
    }
    return json({ status: 'ok', db: 'ok' });
  } catch (err) {
    return json({ status: 'error', db: String(err) }, { status: 503 });
  }
}
