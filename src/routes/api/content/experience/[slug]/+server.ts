import { getExperience } from '$lib/server/db';
import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

export async function GET(event: RequestEvent): Promise<Response> {
  const slug = event.params.slug;
  const entries = getExperience(slug);
  const entry = entries[0];

  if (!entry) throw error(404, 'Experience not found');

  const header = entry.company && entry.role ? `# ${entry.company} — ${entry.role}\n\n` : `# ${entry.slug}\n\n`;

  return new Response(
    JSON.stringify({
      slug: entry.slug,
      company: entry.company ?? '',
      role: entry.role ?? '',
      content: entry.content,
      markdown: `${header}${entry.content.trim()}`,
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
