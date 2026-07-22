import { db } from '$lib/server/db';
import { config } from '$lib/server/config';

export async function GET() {
  const origin = config().app.origin; // e.g. https://woss.io

  const posts = (await db.content.getPosts()).filter((p) => p.status === 'published');
  const experience = (await db.content.getExperience()).filter((e) => e.published !== false);

  const staticPages = [
    { loc: '/', priority: '1.0', changefreq: 'weekly' },
    { loc: '/about', priority: '0.8', changefreq: 'monthly' },
    { loc: '/posts', priority: '0.9', changefreq: 'weekly' },
    { loc: '/experience', priority: '0.8', changefreq: 'monthly' },
    { loc: '/chat', priority: '0.5', changefreq: 'monthly' },
    { loc: '/privacy', priority: '0.3', changefreq: 'yearly' },
  ];

  const postUrls = posts.map((p) => ({
    loc: `/posts/${p.slug}`,
    priority: '0.7',
    changefreq: 'monthly' as const,
    lastmod: p.date ?? undefined,
  }));

  const expUrls = experience.map((e) => ({
    loc: `/experience/${e.slug}`,
    priority: '0.6',
    changefreq: 'monthly' as const,
  }));

  const allUrls = [...staticPages, ...postUrls, ...expUrls];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls
  .map(
    (u) => `  <url>
    <loc>${origin}${u.loc}</loc>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
    ${'lastmod' in u && u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}
  </url>`,
  )
  .join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'max-age=3600, s-maxage=3600',
    },
  });
}
