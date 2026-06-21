import { error } from '@sveltejs/kit';
import { getPosts, getExperience } from '$lib/server/db';
import { renderOgImage } from '$lib/server/og/render';

export const GET = async ({ params }: { params: { slug: string } }) => {
  const slug = params.slug;

  const posts = getPosts();
  const entry = posts.find((p) => p.slug === slug);
  if (entry) {
    const title = entry.title || '';
    const description = entry.excerpt || entry.description || '';

    const png = await renderOgImage(title, description);

    return new Response(png as BodyInit, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }

  const experiences = getExperience();
  const expEntry = experiences.find((e) => e.slug === slug);
  if (expEntry) {
    const title = expEntry.company ? `${expEntry.company} — ${expEntry.role}` : expEntry.slug;
    const description = expEntry.description || '';

    const png = await renderOgImage(title, description);

    return new Response(png as BodyInit, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }

  throw error(404, 'Not found');
};
