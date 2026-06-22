import { error } from '@sveltejs/kit';
import { renderMarkdown } from '$lib/server/markdown';
import { getExperience } from '$lib/server/db';
import type { ExperienceEntry } from '$content/index';

export async function load({ params }: { params: Record<string, string> }) {
  const { slug } = params;

  const entries = getExperience();
  const currentRaw = entries.find((e) => e.slug === slug);
  if (!currentRaw) {
    throw error(404, 'Experience not found');
  }

  const description = currentRaw.description || '';
  const excerpt = description ? description.slice(0, 150) + '...' : '';

  const entry: ExperienceEntry = {
    slug: currentRaw.slug,
    company: currentRaw.company || '',
    role: currentRaw.role || '',
    startDate: currentRaw.startDate || '',
    endDate: currentRaw.endDate || null,
    duration: currentRaw.duration || '',
    skills: currentRaw.skills,
    description: description || currentRaw.content.trim(),
    excerpt,
  };

  const html = await renderMarkdown(entry.description);

  // Build navigation from DB entries (same date sorting as original)
  const navEntries = entries
    .map((e) => {
      return {
        slug: e.slug,
        startDate: e.startDate || null,
        company: e.company || '',
        role: e.role || '',
      };
    })
    .sort((a, b) => {
      if (a.startDate === null && b.startDate === null) return 0;
      if (a.startDate === null) return 1;
      if (b.startDate === null) return -1;
      return b.startDate.localeCompare(a.startDate);
    });

  const idx = navEntries.findIndex((e) => e.slug === slug);
  const nav = {
    prev:
      idx < navEntries.length - 1
        ? { slug: navEntries[idx + 1].slug, company: navEntries[idx + 1].company, role: navEntries[idx + 1].role }
        : null,
    next:
      idx > 0
        ? { slug: navEntries[idx - 1].slug, company: navEntries[idx - 1].company, role: navEntries[idx - 1].role }
        : null,
  };

  const markdown =
    entry.company && entry.role
      ? `# ${entry.company} — ${entry.role}\n\n${currentRaw.content.trim()}`
      : `# ${entry.slug}\n\n${currentRaw.content.trim()}`;

  return { entry, html, nav, markdown };
}
