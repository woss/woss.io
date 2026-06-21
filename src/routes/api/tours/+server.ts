import { getDismissedFeatureTours } from '$lib/server/db';
import type { RequestEvent } from '@sveltejs/kit';

export async function GET(event: RequestEvent): Promise<Response> {
  const userId = event.url.searchParams.get('userId');
  if (!userId) {
    return new Response(JSON.stringify({ error: 'userId query parameter required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const dismissed = getDismissedFeatureTours(userId);
    return new Response(JSON.stringify({ dismissed }), {
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
