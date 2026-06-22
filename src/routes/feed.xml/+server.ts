import { getPosts } from '$lib/server/db';
import { config } from '$lib/server/config';

export async function GET() {
  const origin = config().app.origin;
  const posts = getPosts()
    .filter((p) => p.status === 'published')
    .sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date.localeCompare(a.date);
    });

  const feedTitle = 'woss.io';
  const feedDesc = 'Daniel Maricic — software engineering, distributed systems, and building things.';
  const feedUrl = `${origin}/feed.xml`;
  const siteUrl = origin;
  const updated = posts[0]?.date ? new Date(posts[0].date).toISOString() : new Date().toISOString();

  const entries = posts
    .map(
      (p) => `
  <entry>
    <title>${escapeXml(p.title)}</title>
    <link href="${origin}/posts/${p.slug}"/>
    <id>${origin}/posts/${p.slug}</id>
    <published>${p.date ? new Date(p.date).toISOString() : updated}</published>
    <updated>${p.date ? new Date(p.date).toISOString() : updated}</updated>
    <summary type="html">${escapeXml(p.description || p.excerpt || '')}</summary>
    ${(p.tags || []).map((t) => `<category term="${escapeXml(t)}"/>`).join('\n    ')}
  </entry>`,
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(feedTitle)}</title>
  <subtitle>${escapeXml(feedDesc)}</subtitle>
  <link href="${feedUrl}" rel="self"/>
  <link href="${siteUrl}" rel="alternate"/>
  <id>${siteUrl}</id>
  <updated>${updated}</updated>
  <author>
    <name>Daniel Maricic</name>
    <email>woss@woss.io</email>
  </author>
${entries}
</feed>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/atom+xml; charset=utf-8',
      'Cache-Control': 'max-age=3600, s-maxage=3600',
    },
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
