import { error } from '@sveltejs/kit';
import { getPosts } from '$lib/server/db';
import { renderMarkdown } from '$lib/server/markdown';
import { CAT, createLogger } from '$lib/server/logger';

type HeaderImage = { alt: string; url: string } | null;

type ImageMeta = {
  title?: string;
  creator?: string;
  license?: string;
  licenseShort?: string;
  dataMiningFull?: string;
  unifiedId?: string;
  _links?: { raw?: string };
} | null;

export async function load({ params, fetch }: { params: Record<string, string>; fetch: typeof globalThis.fetch }) {
  const { slug } = params;
  const log = createLogger(CAT.content);

  const allPosts = getPosts();
  const currentRaw = allPosts.find((p) => p.slug === slug);
  if (!currentRaw) {
    throw error(404, 'Post not found');
  }

  const headerImage: HeaderImage = currentRaw.headerImage;

  let imageMeta: ImageMeta = null;
  if (headerImage?.url) {
    const match = headerImage.url.match(/u\.macula\.link\/([a-zA-Z0-9_-]+)/);
    if (match) {
      try {
        const res = await fetch(`https://u.macula.link/${match[1]}.json`);
        if (res.ok) imageMeta = await res.json();
      } catch {
        /* ignore */
      }
    }
  }

  // Load workflow files with placeholder replacements
  let workflowFiles:
    | {
        label: string;
        json: string;
        placeholders: { key: string; label: string; hint?: string }[];
      }[]
    | null = null;
  if (currentRaw.workflowFiles?.length) {
    const wfEntries = currentRaw.workflowFiles;
    const loaded: {
      label: string;
      json: string;
      placeholders: { key: string; label: string; hint?: string }[];
    }[] = [];
    for (const wf of wfEntries) {
      try {
        const res = await fetch(`/files/${wf.file}`);
        if (res.ok) {
          loaded.push({
            label: wf.label,
            json: await res.text(),
            placeholders: wf.placeholders,
          });
        }
      } catch {
        // skip if file not found
      }
    }
    if (loaded.length > 0) workflowFiles = loaded;
  }

  const current = {
    slug: currentRaw.slug,
    title: currentRaw.title || '',
    date: currentRaw.date || null,
    tags: currentRaw.tags,
    excerpt: currentRaw.excerpt || '',
    body: currentRaw.content,
    headerImage,
    toc: currentRaw.toc,
  };

  const publishedPosts = allPosts
    .filter((p) => p.status === 'published')
    .map((p) => ({
      slug: p.slug,
      title: p.title || '',
      date: p.date || null,
    }))
    .sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date.localeCompare(a.date);
    });

  let html: string;
  try {
    html = await renderMarkdown(current.body);
  } catch (e) {
    log.error`Failed to render markdown for ${slug}: ${e}`;
    html = '<p>Failed to render post content.</p>';
  }
  const h1Stripped = html.replace(/^<h1[^>]*>.*?<\/h1>\s*/i, '');

  const currentIndex = publishedPosts.findIndex((p) => p.slug === slug);
  const nav = {
    prev:
      currentIndex < publishedPosts.length - 1
        ? { slug: publishedPosts[currentIndex + 1].slug, title: publishedPosts[currentIndex + 1].title }
        : null,
    next:
      currentIndex > 0
        ? { slug: publishedPosts[currentIndex - 1].slug, title: publishedPosts[currentIndex - 1].title }
        : null,
  };

  // Series siblings
  let series: { title: string; items: { slug: string; title: string }[]; currentSlug: string } | null = null;

  try {
    if (currentRaw.partOfSeries) {
      // This post is part of a series — find root + siblings
      const root = allPosts.find((p) => p.id === currentRaw.partOfSeries);
      if (root) {
        const children = allPosts
          .filter((p) => p.partOfSeries === currentRaw.partOfSeries)
          .map((p) => ({ slug: p.slug, title: p.title }));
        const items = [{ slug: root.slug, title: root.title }, ...children];
        series = { title: root.title, items, currentSlug: slug };
      }
    } else if (currentRaw.id) {
      // This might be a series root — find children
      const children = allPosts
        .filter((p) => p.partOfSeries === currentRaw.id)
        .map((p) => ({ slug: p.slug, title: p.title }));
      if (children.length > 0) {
        const items = [{ slug: currentRaw.slug, title: currentRaw.title }, ...children];
        series = { title: currentRaw.title, items, currentSlug: currentRaw.slug };
      }
    }
  } catch (e) {
    log.error`Failed to resolve series for ${slug}: ${e}`;
    series = null;
  }

  return {
    series,
    post: {
      slug: current.slug,
      title: current.title,
      date: current.date,
      tags: current.tags,
      excerpt: current.excerpt,
      headerImage: current.headerImage,
      toc: current.toc,
      body: current.body,
    },
    html: h1Stripped,
    nav,
    imageMeta,
    workflowFiles,
  };
}
