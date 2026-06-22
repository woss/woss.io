<script lang="ts">
  import 'highlight.js/styles/atom-one-dark.css';
  import { toast } from 'svelte-sonner';
  import { copyToClipboard } from '$lib/utils/clipboard';
  import ImageAttribution from '$lib/components/ImageAttribution.svelte';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import Seo from '$lib/components/Seo.svelte';
  import { appendQueryParams } from '$lib/utils/utm';
  import CopyComponent from '$lib/components/CopyComponent.svelte';
  import { Separator, Badge, Accordion } from 'sv5ui';
  import WorkflowReplacer from '$lib/components/WorkflowReplacer.svelte';

  type Post = {
    slug: string;
    title: string;
    date: string | null;
    tags: string[];
    excerpt: string;
    headerImage: { alt: string; url: string } | null;
    toc: { id: string; text: string; level: number }[];
    body: string;
    partOfSeries?: number;
  };
  type NavLink = { slug: string; title: string } | null;
  type ImageMeta = {
    title?: string;
    creator?: string;
    license?: string;
    licenseShort?: string;
    dataMiningFull?: string;
    unifiedId?: string;
    _links?: { raw?: string };
  } | null;

  let {
    data,
  }: {
    data: {
      post: Post;
      html: string;
      nav: { prev: NavLink; next: NavLink };
      imageMeta: ImageMeta | null;
      series: { title: string; items: { slug: string; title: string }[]; currentSlug: string } | null;
      workflowFiles: { label: string; json: string; placeholders: { key: string; label: string; hint?: string }[] }[] | null;
    };
  } = $props();

  let activeId = $state<string | null>(null);
  let qp = $derived(page.data.queryParams);
  let readingTime = $derived(Math.max(1, Math.ceil((data.post.body || '').split(/\s+/).filter(Boolean).length / 200)));
  let scrollPercent = $state(0);
  $effect(() => {
    const onScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      scrollPercent = docHeight > 0 ? Math.min((scrollTop / docHeight) * 100, 100) : 0;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  });

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length < 2) return dateStr;
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1;
    const day = parts.length > 2 ? parseInt(parts[2]) : undefined;
    const date = day ? new Date(year, month, day) : new Date(year, month);
    const options: Intl.DateTimeFormatOptions = day
      ? { year: 'numeric', month: 'long', day: 'numeric' }
      : { year: 'numeric', month: 'long' };
    return date.toLocaleDateString('en-US', options);
  }

  function dateAttrib(dateStr: string | null): string {
    if (!dateStr) return '';
    return dateStr;
  }

  async function handleCopy(event: Event) {
    const target = event.target as HTMLElement;
    const btn = target.closest('[data-copy-btn]') as HTMLElement | null;
    if (!btn) return;

    const code = btn.dataset.code || '';
    if (!code) return;

    if (copyToClipboard(code)) {
      toast.success('Code copied');
    }
  }

  function formatPostMd(): string {
    const p = data.post;
    const tags = p.tags.length > 0 ? `Tags: ${p.tags.join(', ')}\n\n` : '\n';
    return `# ${p.title}\nDate: ${p.date ?? ''}\n${tags}${p.body}`;
  }

  // Track scroll position for active TOC heading
  $effect(() => {
    void data.html;

    const raf = requestAnimationFrame(() => {
      const headings = document.querySelectorAll<HTMLElement>('article h2, article h3');
      if (headings.length === 0) return;

      const observer = new IntersectionObserver(
        (entries) => {
          const visible = entries
            .filter((e) => e.isIntersecting)
            .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
          if (visible.length > 0) {
            activeId = visible[0].target.id;
          }
        },
        { rootMargin: '-80px 0px -60% 0px', threshold: 0 },
      );

      headings.forEach((h) => observer.observe(h));

      return () => observer.disconnect();
    });

    return () => cancelAnimationFrame(raf);
  });

  // Copy button setup
  $effect(() => {
    void data.html;

    const raf = requestAnimationFrame(() => {
      const pres = document.querySelectorAll<HTMLPreElement>('article pre');
      pres.forEach((pre, index) => {
        if (pre.querySelector('[data-copy-btn]')) return;

        const code = pre.querySelector('code');
        if (!code?.textContent) return;

        pre.style.position = 'relative';

        const btn = document.createElement('button');
        btn.className = 'copy-btn';
        btn.dataset.copyBtn = String(index);
        btn.dataset.code = code.textContent;
        btn.setAttribute('aria-label', 'Copy code to clipboard');
        btn.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        btn.addEventListener('click', handleCopy);
        pre.appendChild(btn);
      });
    });

    return () => cancelAnimationFrame(raf);
  });
  // Mermaid tab switching — lazy-loads SVG on first "Diagram" click
  $effect(() => {
    void data.html;
    const controllers: AbortController[] = [];
    const raf = requestAnimationFrame(() => {
      const containers = document.querySelectorAll<HTMLElement>('.mermaid-tabs');
      if (containers.length === 0) return;
      containers.forEach((container) => {
        const ac = new AbortController();
        controllers.push(ac);
        const sourceBtn = container.querySelector<HTMLButtonElement>('[data-tab="source"]');
        const diagramBtn = container.querySelector<HTMLButtonElement>('[data-tab="diagram"]');
        const sourceTab = container.querySelector<HTMLElement>('.source-tab');
        const diagramTab = container.querySelector<HTMLElement>('.diagram-tab');
        if (!sourceBtn || !diagramBtn || !sourceTab || !diagramTab) return;

        sourceBtn.addEventListener(
          'click',
          () => {
            sourceTab.classList.remove('hidden');
            diagramTab.classList.add('hidden');
            sourceBtn.classList.remove('text-slate-400', 'border-transparent');
            sourceBtn.classList.add('text-green-400', 'border-green-400');
            diagramBtn.classList.remove('text-green-400', 'border-green-400');
            diagramBtn.classList.add('text-slate-400', 'border-transparent');
          },
          { signal: ac.signal },
        );
        diagramBtn.addEventListener(
          'click',
          () => {
            sourceTab.classList.add('hidden');
            diagramTab.classList.remove('hidden');
            diagramBtn.classList.remove('text-slate-400', 'border-transparent');
            diagramBtn.classList.add('text-green-400', 'border-green-400');
            sourceBtn.classList.remove('text-green-400', 'border-green-400');
            sourceBtn.classList.add('text-slate-400', 'border-transparent');
            diagramTab.innerHTML = `<div class="flex items-center justify-center p-8" style="min-height:100px">
 <svg viewBox="0 0 400 120" fill="none" xmlns="http://www.w3.org/2000/svg" class="w-full max-w-sm">
 <!-- Remote server (left) -->
 <rect x="30" y="35" width="60" height="50" rx="6" stroke="currentColor" stroke-width="2" class="text-cyan-400" fill="none"/>
 <circle cx="50" cy="72" r="4" fill="currentColor" class="text-cyan-400"/>
 <circle cx="70" cy="72" r="4" fill="currentColor" class="text-cyan-400"/>
 <line x1="45" y1="45" x2="75" y2="45" stroke="currentColor" stroke-width="2" class="text-cyan-400"/>
 <line x1="45" y1="52" x2="65" y2="52" stroke="currentColor" stroke-width="2" class="text-cyan-400" stroke-dasharray="3 2"/>

 <!-- Animated dashed arrow -->
 <line x1="95" y1="60" x2="175" y2="60" stroke="currentColor" stroke-width="2" stroke-dasharray="6 4" class="text-green-400">
 <animate attributeName="stroke-dashoffset" from="0" to="-20" dur="1s" repeatCount="indefinite"/>
 </line>
 <polygon points="175,54 185,60 175,66" fill="currentColor" class="text-green-400"/>

 <!-- Light beams from data -->
 <line x1="50" y1="35" x2="50" y2="22" stroke="currentColor" stroke-width="1.5" class="text-green-400/60">
 <animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite"/>
 </line>
 <line x1="70" y1="35" x2="70" y2="22" stroke="currentColor" stroke-width="1.5" class="text-green-400/60">
 <animate attributeName="opacity" values="0.3;1;0.3" dur="1.5s" begin="0.5s" repeatCount="indefinite"/>
 </line>

 <!-- Diagram panel (right) -->
 <rect x="200" y="35" width="80" height="50" rx="6" stroke="currentColor" stroke-width="2" class="text-cyan-300" fill="none"/>
 <circle cx="225" cy="55" r="8" stroke="currentColor" stroke-width="1.5" class="text-cyan-300" fill="none"/>
 <rect x="238" y="48" width="32" height="14" rx="2" stroke="currentColor" stroke-width="1.5" class="text-cyan-300" fill="none"/>
 <line x1="220" y1="70" x2="260" y2="70" stroke="currentColor" stroke-width="1.5" class="text-cyan-300" stroke-dasharray="2 2"/>
 <line x1="220" y1="76" x2="250" y2="76" stroke="currentColor" stroke-width="1.5" class="text-cyan-300" stroke-dasharray="2 2"/>

 <!-- Spinner at diagram end -->
 <circle cx="330" cy="60" r="12" stroke="currentColor" stroke-width="2" class="text-green-400" fill="none" stroke-dasharray="18 38">
 <animateTransform attributeName="transform" type="rotate" from="0 330 60" to="360 330 60" dur="1.2s" repeatCount="indefinite"/>
 </circle>

 <!-- Text -->
 <text x="200" y="110" text-anchor="middle" font-family="monospace" font-size="12" fill="currentColor" class="text-slate-400">remote diagram rendering — coming soon</text>
 </svg>
</div>`;
          },
          { signal: ac.signal },
        );
      });
    });
    return () => {
      cancelAnimationFrame(raf);
      controllers.forEach((ac) => ac.abort());
    };
  });
</script>

<Seo
  title="{data.post.title} · woss.io"
  description={data.post.excerpt}
  image={data.post.headerImage?.url ?? `https://woss.io/api/og/${page.params.slug}.png`}
  type="article"
  publishedTime={data.post.date}
  tags={data.post.tags}
/>

<!-- Skip to content link -->
<a
  href="#main-content"
  class="absolute -top-full left-4 px-4 py-2 bg-primary text-surface text-sm font-semibold rounded-md z-200 transition-all duration-150 focus:top-4"
  >Skip to content</a
>

<div
  class="fixed top-0 left-0 h-[2px] bg-primary z-50"
  style="width: {scrollPercent}%"
  role="progressbar"
  aria-label="Reading progress"
  aria-valuenow={scrollPercent}
></div>

<section class="pb-24 overflow-x-hidden">
  <div class="container max-w-6xl mx-auto px-4">
    <a
      href={resolve('/posts')}
      class="mb-4 font-mono text-sm text-on-surface-variant no-underline cursor-pointer transition-colors duration-200 hover:text-primary"
      >← Back to posts</a
    >
    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_220px] gap-6 xl:gap-10">
      <!-- Content column -->
      <div class="flex flex-col gap-6">
        <article
          id="main-content"
          class="bg-surface-container border border-[rgba(255,255,255,0.08)] rounded-lg overflow-hidden p-4 md:p-6 lg:p-8"
        >
          {#if data.post.headerImage}
            <figure
              class="relative m-0 mb-10 mx-[-17px] md:mx-[-25px] lg:mx-[-33px] mt-[-17px] md:mt-[-25px] lg:mt-[-33px]"
            >
              {#if data.post.headerImage.url.includes('u.macula.link')}
                {@const base = data.post.headerImage.url.split('?')[0]}
                <picture class="block">
                  <source media="(max-width: 480px)" srcset={appendQueryParams(base + '?preset=sys_sm', qp)} />
                  <source media="(max-width: 768px)" srcset={appendQueryParams(base + '?preset=sys_md', qp)} />
                  <source media="(max-width: 1024px)" srcset={appendQueryParams(base + '?preset=sys_lg', qp)} />
                  <img
                    src={appendQueryParams(base + '?preset=sys_xl', qp)}
                    alt={data.post.headerImage.alt}
                    width="1200" height="600"
                    class="w-full object-cover aspect-2/1 max-sm:aspect-3/1"
                    loading="eager"
                  />
                </picture>
              {:else}
                <img
                  src={data.post.headerImage.url}
                  alt={data.post.headerImage.alt}
                  width="1200" height="600"
                  class="w-full object-cover aspect-2/1 max-sm:aspect-3/1"
                  loading="eager"
                />
              {/if}
              <CopyComponent text={formatPostMd()} toastMessage="Post copied as Markdown" label="Copy as Markdown" class="absolute top-3 right-3 z-10 bg-black/30 hover:bg-black/50 text-white rounded-md" />
              {#if data.imageMeta}
                <ImageAttribution
                  title={data.imageMeta.title ?? data.post.headerImage.alt}
                  creator={data.imageMeta.creator}
                  license={data.imageMeta.licenseShort ?? data.imageMeta.license}
                  dataMining={data.imageMeta.dataMiningFull}
                  maculaUrl={data.imageMeta._links?.raw
                    ? appendQueryParams(`https://u.macula.link/${data.imageMeta.unifiedId}/`, qp)
                    : ''}
                />
              {/if}
            </figure>
          {:else}
            <figure
              class="relative m-0 mb-10 mx-[-17px] md:mx-[-25px] lg:mx-[-33px] mt-[-17px] md:mt-[-25px] lg:mt-[-33px]"
            >
              <img
                src={`/api/og/${data.post.slug}.png`}
                alt={data.post.title}
                width="1200" height="600"
                class="w-full object-cover aspect-2/1"
                loading="lazy"
              />
            <CopyComponent text={formatPostMd()} toastMessage="Post copied as Markdown" label="Copy as Markdown" class="absolute top-3 right-3 z-10 bg-black/30 hover:bg-black/50 text-white rounded-md" />
            </figure>
          {/if}

          <header class="mb-6 md:mb-12">
            <h1
              class="font-heading text-2xl/tight md:text-3xl lg:text-4xl font-bold tracking-[-0.03em] m-0 mb-4 text-white"
            >
              {data.post.title}
            </h1>
            <div class="flex items-center gap-2 md:gap-4 flex-wrap mb-3 md:mb-6">
              {#if data.post.date}
                <time
                  datetime={dateAttrib(data.post.date)}
                  class="text-sm text-on-surface-variant font-mono tracking-[0.02em]"
                >
                  {formatDate(data.post.date)} · {readingTime} min read
                </time>
              {/if}
              {#if data.post.tags.length > 0}
                <ul class="flex flex-wrap gap-2 list-none p-0 m-0" aria-label="Tags">
                  {#each data.post.tags as tag (tag)}
                    <Badge as="li" variant="soft" color="secondary" size="sm" class="tracking-[0.03em] uppercase">{tag}</Badge>
                  {/each}
                </ul>
              {/if}
            </div>
            <Separator color="primary" size="xs" class="my-4 md:my-8" ui={{ border: 'bg-[linear-gradient(90deg,var(--color-primary),var(--color-secondary))]' }} />
          </header>

          {#if data.series}
            {@const series = data.series}
            {@const items = series.items}
            {@const idx = items.findIndex((i) => i.slug === series.currentSlug)}
            <Accordion
              items={[{ value: 'series' }]}
              type="single"
              ui={{
                root: 'w-full bg-surface-container border border-[rgba(255,255,255,0.08)] rounded-lg mb-8',
                trigger: 'flex items-center justify-between p-4 text-xs font-mono font-semibold text-secondary uppercase tracking-[0.08em]',
                label: 'flex w-full items-center justify-between',
                item: 'border-0',
              }}
            >
              {#snippet label()}
                <span>Series: {series.title}</span>
                <span class="text-xs font-mono text-on-surface-variant">Part {idx + 1} of {items.length}</span>
              {/snippet}
              {#snippet content()}
                <div class="px-4 pb-4 space-y-1">
                  {#each series.items as item, i (item.slug)}
                    {@const isCurrent = item.slug === series.currentSlug}
                    <a
                      href={resolve('/posts/[slug]', { slug: item.slug })}
                      class="flex items-center gap-3 px-3 py-2 font-mono text-sm no-underline rounded-md transition-colors duration-150 {isCurrent
                        ? 'bg-[color-mix(in_srgb,var(--color-secondary)_10%,transparent)] text-secondary font-semibold'
                        : 'text-on-surface-variant hover:bg-[color-mix(in_srgb,var(--color-primary)_8%,transparent)] hover:text-primary'}"
                    >
                      <span class="text-xs shrink-0 {isCurrent ? 'text-secondary' : 'text-on-surface-variant'}"
                        >{i + 1}</span
                      >
                      <span class="truncate">{item.title}</span>
                      {#if isCurrent}
                        <span class="ml-auto text-[10px] text-secondary/70 font-mono uppercase tracking-wider shrink-0"
                          >Reading</span
                        >
                      {/if}
                    </a>
                  {/each}
                </div>
              {/snippet}
            </Accordion>
          {/if}

          <div class="overflow-x-auto prose prose-invert max-w-none">
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html data.html}
          </div>

          {#if data.workflowFiles}
            <div class="mt-8">
              <h2 class="font-heading text-xl/tight md:text-2xl font-bold tracking-[-0.03em] m-0 mb-4 text-white">
                Embedded Workflow
              </h2>
              <WorkflowReplacer workflowFiles={data.workflowFiles} />
            </div>
          {/if}

          <Separator color="primary" size="xs" class="my-8" ui={{ border: 'bg-[linear-gradient(90deg,var(--color-primary),var(--color-secondary))]' }} />

          {#if data.post.date}
            <p class="text-sm text-on-surface-variant font-mono m-0 mb-4">
              Published <time datetime={dateAttrib(data.post.date)}>{formatDate(data.post.date)}</time>
            </p>
          {/if}

          {#if data.nav.prev || data.nav.next}
            <nav class="grid grid-cols-2 gap-4 my-6" aria-label="Adjacent posts">
              {#if data.nav.prev}
                <a
                  href={resolve('/posts/[slug]', { slug: data.nav.prev.slug })}
                  class="inline-flex items-center p-4 border border-[rgba(255,255,255,0.08)] rounded-md no-underline transition-all duration-200 hover:border-primary hover:shadow-[0_0_20px_rgba(0,218,140,0.15)] text-secondary font-mono text-xs uppercase tracking-[0.08em]"
                >
                  &larr; Previous
                </a>
              {:else}
                <div></div>
              {/if}
              {#if data.nav.next}
                <a
                  href={resolve('/posts/[slug]', { slug: data.nav.next.slug })}
                  class="inline-flex items-center justify-end p-4 border border-[rgba(255,255,255,0.08)] rounded-md no-underline transition-all duration-200 hover:border-primary hover:shadow-[0_0_20px_rgba(0,218,140,0.15)] text-secondary font-mono text-xs uppercase tracking-[0.08em]"
                >
                  Next &rarr;
                </a>
              {/if}
            </nav>
          {/if}
        </article>
      </div>

      <!-- TOC sidebar column -->
      <aside class="hidden lg:block self-start">
        <nav
          class="sticky top-24 space-y-1 border-l border-[rgba(255,255,255,0.08)] pl-4"
          aria-label="Table of contents"
        >
          <span class="block text-xs font-mono font-semibold text-on-surface-variant uppercase tracking-[0.06em] mb-3"
            >On this page</span
          >
          {#each data.post.toc as entry (entry.id)}
            <a
              href={'#' + entry.id}
              class="block text-sm/snug transition-all duration-150 no-underline {entry.level === 3
                ? 'pl-4'
                : ''} {activeId === entry.id
                ? 'text-primary font-medium'
                : 'text-on-surface-variant hover:text-on-surface'}"
            >
              {entry.text}
            </a>
          {/each}
        </nav>
      </aside>
    </div>
  </div>
</section>

<style>
  :global(.copy-btn) {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    z-index: 1;
    cursor: pointer;
    padding: 0.4rem;
    border: none;
    background: transparent;
    color: inherit;
    line-height: 0;
    border-radius: 4px;
    transition: opacity 0.15s;
    opacity: 0.7;
  }
  :global(.copy-btn:hover) {
    opacity: 1;
  }

  :global(.prose ul),
  :global(.prose ol) {
    margin-top: 0.5em;
    margin-bottom: 0.5em;
  }

  :global(.prose li) {
    margin-top: 0.15em;
    margin-bottom: 0.15em;
  }

  :global(.prose li > ul),
  :global(.prose li > ol) {
    margin-top: 0.25em;
    margin-bottom: 0.25em;
  }
</style>
