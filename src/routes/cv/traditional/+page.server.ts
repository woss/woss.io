import { getExperience } from '$lib/server/db';

export function load() {
  const entries = getExperience()
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

  // Aggregate skills by frequency
  const freq = new Map<string, number>();
  for (const e of entries) {
    for (const s of e.skills) {
      freq.set(s, (freq.get(s) || 0) + 1);
    }
  }

  const hotSkills = [...freq.entries()]
    .map(([skill, count]) => ({ skill, count }))
    .sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill));

  const allSkills = [...new Set(entries.flatMap((e) => e.skills))].sort();

  return { experience: entries, skills: allSkills, hotSkills };
}
