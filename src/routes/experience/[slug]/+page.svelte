<script lang="ts">
 import { resolve } from '$app/paths';
 import { page } from '$app/state';
 import type { ExperienceEntry } from '$lib/../content/index';
 import Seo from '$lib/components/Seo.svelte';
  import { Separator, Badge } from 'sv5ui';
  import CopyComponent from '$lib/components/CopyComponent.svelte';

 type NavLink = { slug: string; company: string; role: string } | null;

 let { data }: {
 data: {
 entry: ExperienceEntry;
 html: string;
 nav: { prev: NavLink; next: NavLink };
 markdown: string;
 }
 } = $props();

 let visible = $state(false);

 $effect(() => {
 const raf = requestAnimationFrame(() => { visible = true; });
 return () => cancelAnimationFrame(raf);
 });

 function formatDate(dateStr: string): string {
 const d = new Date(dateStr + '-01');
 return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
 }
</script>

<Seo
 title="{data.entry.role} at {data.entry.company} — woss.io"
 description={data.entry.excerpt}
 image={`https://woss.io/api/og/${page.params.slug}.png`}
/>

<section
 class="py-20 pb-24 opacity-0 translate-y-4 transition-all duration-500"
 class:opacity-100={visible}
 class:translate-y-0={visible}
>
 <div class="container mx-auto px-4">
 <article class="bg-surface-container border border-[rgba(255,255,255,0.08)] rounded-lg p-8">
 <header class="mb-6">
 <div class="flex items-center gap-2 mb-2">
 <p class="font-mono text-sm text-secondary uppercase tracking-[0.08em] m-0">{data.entry.company}</p>
 <CopyComponent text={data.markdown} toastMessage="Copied as Markdown" label="Copy as markdown" />
 </div>
 <h1 class="font-heading text-3xl text-primary m-0 mb-3 leading-[1.2]">{data.entry.role}</h1>
 <p class="font-mono text-sm text-on-surface-variant m-0">
 <time datetime={data.entry.startDate}>{formatDate(data.entry.startDate)}</time>
 <span class="text-secondary">&thinsp;–&thinsp;</span>
 {#if data.entry.endDate}
 <time datetime={data.entry.endDate}>{formatDate(data.entry.endDate)}</time>
 {:else}
 <span class="text-primary">{data.entry.duration}</span>
 {/if}
 </p>
 </header>

  <Separator color="primary" size="xs" class="my-6" ui={{ border: 'bg-[linear-gradient(90deg,var(--color-primary),var(--color-secondary))]' }} />

  {#if data.entry.skills.length > 0}
 <div class="flex flex-wrap gap-2 my-4" role="list">
 {#each data.entry.skills as skill (skill)}
  <Badge variant="soft" color="secondary" size="sm" class="tracking-[0.03em]" role="listitem">{skill}</Badge>
 {/each}
 </div>
 {/if}

 {#if data.html}
 <div class="description font-body text-base/relaxed text-on-surface">
 <!-- eslint-disable-next-line svelte/no-at-html-tags -->
 {@html data.html}
 </div>
 {/if}

  <Separator color="primary" size="xs" class="my-6" ui={{ border: 'bg-[linear-gradient(90deg,var(--color-primary),var(--color-secondary))]' }} />

  <nav class="grid grid-cols-2 gap-4 my-6" aria-label="Experience navigation">
 {#if data.nav.prev}
 <a href={resolve(`/experience/${data.nav.prev.slug}`)} class="flex flex-col gap-1 p-4 border border-[rgba(255,255,255,0.08)] rounded-md no-underline transition-all duration-200 hover:border-primary hover:shadow-[0_0_20px_rgba(0,218,140,0.15)]">
 <span class="font-mono text-xs text-secondary uppercase tracking-[0.08em]">Previous</span>
 <span class="font-heading text-base text-primary">{data.nav.prev.company}</span>
 <span class="font-body text-sm text-on-surface-variant">{data.nav.prev.role}</span>
 </a>
 {:else}
 <div></div>
 {/if}
 {#if data.nav.next}
 <a href={resolve(`/experience/${data.nav.next.slug}`)} class="flex flex-col gap-1 p-4 border border-[rgba(255,255,255,0.08)] rounded-md no-underline transition-all duration-200 hover:border-primary hover:shadow-[0_0_20px_rgba(0,218,140,0.15)] text-right">
 <span class="font-mono text-xs text-secondary uppercase tracking-[0.08em]">Next</span>
 <span class="font-heading text-base text-primary">{data.nav.next.company}</span>
 <span class="font-body text-sm text-on-surface-variant">{data.nav.next.role}</span>
 </a>
 {:else}
 <div></div>
 {/if}
 </nav>

 <a href={resolve('/experience')} class="inline-block mt-4 font-mono text-sm text-on-surface-variant no-underline transition-colors duration-200 hover:text-primary">← Back to timeline</a>
 </article>
 </div>
</section>

<style>
 .description :global(p) { margin-block: var(--space-4); }
 .description :global(ul),
 .description :global(ol) {
 padding-left: var(--space-6);
 margin-block: var(--space-3);
 }
 .description :global(li) { margin-block: var(--space-1); }
 .description :global(code) {
 font-family: var(--font-mono, monospace);
 font-size: 0.9em;
 padding: 0.1em 0.3em;
 background: rgba(255, 255, 255, 0.08);
 border-radius: 4px;
 }
</style>
