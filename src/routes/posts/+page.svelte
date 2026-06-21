<script lang="ts">
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import { Separator, Badge } from 'sv5ui';
  import Seo from '$lib/components/Seo.svelte';
  import { appendQueryParams } from '$lib/utils/utm';

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }

  let visible = $state<boolean[]>([]);
  let gridEl = $state<HTMLDivElement | undefined>(undefined);

  let qp = $derived(page.data.queryParams);

  $effect(() => {
    const posts = page.data.posts;
    if (!gridEl || !posts || posts.length === 0) return;

    visible = new Array(posts.length).fill(false);

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      visible = new Array(posts.length).fill(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = Number((entry.target as HTMLElement).dataset.index);
            visible[idx] = true;
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
    );

    const cards = gridEl.querySelectorAll('[data-index]');
    for (const card of cards) {
      observer.observe(card);
    }

    return () => observer.disconnect();
  });
</script>

<Seo title="Posts — woss.io" description="Blog posts by @woss" />

<section class="max-w-300 mx-auto px-6 pb-24 max-md:px-4">
  <header class="mb-12">
    <h1 class="font-heading text-4xl font-bold text-on-surface tracking-[-0.03em] uppercase m-0">Posts</h1>
    <Separator color="primary" size="xs" class="w-16 mt-3" ui={{ border: 'bg-[linear-gradient(90deg,var(--color-primary),var(--color-secondary))]' }} />
  </header>

  {#if page.data.posts.length === 0}
    <p class="font-heading text-lg text-on-surface-variant text-center py-20">No posts yet.</p>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6" bind:this={gridEl}>
      {#each page.data.posts as post, i (post.slug)}
        <article
          class="bg-surface-container border border-[rgba(255,255,255,0.08)] rounded-lg overflow-hidden transition-all duration-500 opacity-0 translate-y-6 hover:border-primary hover:shadow-[0_0_20px_rgba(0,218,140,0.15)] hover:-translate-y-0.5"
          class:opacity-100={visible[i]}
          class:translate-y-0={visible[i]}
          class:featured-glow={post.featured}
          data-index={i}
          style="transition-delay: {i * 50}ms; transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1)"
        >
          <a href={resolve(`/posts/${post.slug}`)} class="block" tabindex="-1">
            {#if post.headerImage}
              {#if post.headerImage.url.includes('u.macula.link')}
                {@const base = post.headerImage.url.split('?')[0]}
                <picture>
                  <source media="(max-width: 480px)" srcset={appendQueryParams(base + '?preset=sys_sm', qp)} />
                  <source media="(max-width: 768px)" srcset={appendQueryParams(base + '?preset=sys_md', qp)} />
                  <source media="(max-width: 1024px)" srcset={appendQueryParams(base + '?preset=sys_lg', qp)} />
                  <img
                    src={appendQueryParams(base + '?preset=sys_xl', qp)}
                    alt={post.headerImage.alt}
                    width="1200" height="600"
                    loading="lazy"
                    class="w-full aspect-2/1 object-cover"
                  />
                </picture>
              {:else}
                <img src={post.headerImage.url} alt={post.headerImage.alt} width="1200" height="600" class="w-full aspect-2/1 object-cover" />
              {/if}
            {:else}
              <img
                loading="lazy"
                src={`/api/og/${post.slug}.png`}
                alt={post.title}
                width="1200" height="600"
                class="w-full aspect-2/1 object-cover"
              />
            {/if}
          </a>
          <a
            href={resolve(`/posts/${post.slug}`)}
            class="flex flex-col p-6 no-underline text-inherit gap-3 focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-4 focus-visible:rounded-lg"
            aria-label="Read: {post.title}"
          >
            {#if post.tags.length > 0}
              <div class="flex flex-wrap gap-2 mb-1">
                {#each post.tags as tag (tag)}
                  <Badge variant="soft" color="secondary" size="sm" class="tracking-[0.02em] uppercase">{tag}</Badge>
                {/each}
              </div>
            {/if}

            <h2 class="font-heading text-lg/tight md:text-xl font-bold text-on-surface m-0 tracking-[-0.01em]">
              {post.title}
            </h2>

            <p class="text-sm/normal text-on-surface-variant m-0 line-clamp-2">{post.excerpt}</p>

            {#if post.date}
              <time
                datetime={post.date}
                class="font-mono text-xs text-outline mt-auto pt-2 border-t border-[rgba(255,255,255,0.08)]"
                >{formatDate(post.date)}</time
              >
            {/if}
          </a>
        </article>
      {/each}
    </div>
  {/if}
</section>

<style>
  :global(.featured-glow) {
    box-shadow: 0 0 18px 2px rgba(0, 255, 136, 0.15);
    border-color: rgba(0, 255, 136, 0.25);
  }
</style>
