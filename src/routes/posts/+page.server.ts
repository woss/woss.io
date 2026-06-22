import { getPosts } from '$lib/server/db';
import type { BlogPost } from '$content/index';

export async function load() {
  const records = getPosts();

  const posts: BlogPost[] = records
    .map((r) => {
      return {
        slug: r.slug,
        title: r.title || '',
        date: r.date || null,
        tags: r.tags,
        excerpt: r.excerpt || '',
        body: r.content,
        status: r.status,
        featured: r.featured,
        headerImage: r.headerImage ?? undefined,
        partOfSeries: r.partOfSeries ?? undefined,
      };
    })
    .filter((p) => p.status === 'published')
    .sort((a, b) => {
      if (a.date === null && b.date === null) return 0;
      if (a.date === null) return 1;
      if (b.date === null) return -1;
      return b.date.localeCompare(a.date);
    });

  return { posts };
}
