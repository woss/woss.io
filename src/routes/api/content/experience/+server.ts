import { getExperience } from '$lib/server/db';

export async function GET(): Promise<Response> {
  const entries = getExperience();

  return new Response(
    JSON.stringify({
      entries: entries.map((e) => ({
        slug: e.slug,
        company: e.company ?? '',
        role: e.role ?? '',
        content: e.content,
        meta: {
          company: e.company,
          role: e.role,
          startDate: e.startDate,
          endDate: e.endDate,
          duration: e.duration,
          skills: e.skills,
          description: e.description,
        },
      })),
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
