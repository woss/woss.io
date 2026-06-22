import { getExperience } from '$lib/server/db';
import type { ExperienceEntry } from '$content/index';

export async function load() {
  const records = getExperience();

  const entries: ExperienceEntry[] = records.map((r) => {
    const description = r.description || r.content.trim();

    return {
      slug: r.slug,
      company: r.company || '',
      role: r.role || '',
      startDate: r.startDate || '',
      endDate: r.endDate || null,
      duration: r.duration || '',
      skills: r.skills,
      description,
      excerpt: description ? description.slice(0, 150) + '...' : r.content.trim().slice(0, 150) + '...',
    };
  });

  // Sort: current (endDate null) first, then by startDate descending
  entries.sort((a, b) => {
    const aCurrent = a.endDate === null;
    const bCurrent = b.endDate === null;
    if (aCurrent && !bCurrent) return -1;
    if (!aCurrent && bCurrent) return 1;
    if (a.startDate !== null && b.startDate !== null) {
      const dateCmp = b.startDate.localeCompare(a.startDate);
      if (dateCmp !== 0) return dateCmp;
    }
    if (a.startDate === null) return 1;
    if (b.startDate === null) return -1;
    if (a.endDate !== null && b.endDate !== null) {
      return b.endDate.localeCompare(a.endDate);
    }
    if (a.endDate === null && b.endDate === null) return 0;
    return aCurrent ? -1 : 1;
  });

  return { entries };
}
