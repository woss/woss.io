import { db } from '$lib/server/db';

export async function load() {
  const entries = (await db.content.getExperience())
    .filter((e) => e.published !== false)
    .sort((a, b) => {
      if (!a.startDate && !b.startDate) return 0;
      if (!a.startDate) return 1;
      if (!b.startDate) return -1;
      return b.startDate.localeCompare(a.startDate);
    })
    .map((e) => ({
      slug: e.slug,
      company: e.company,
      role: e.role,
      duration: e.duration,
      description: e.description || '',
      jobRole: e.jobRole || '',
      skills: e.skills,
    }));

  return { experience: entries };
}
