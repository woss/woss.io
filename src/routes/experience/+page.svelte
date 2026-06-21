<script lang="ts">
 import { browser } from '$app/environment';
 import { resolve } from '$app/paths';
 import type { ExperienceEntry } from '$content';
 import Seo from '$lib/components/Seo.svelte';
 import { SvelteDate } from 'svelte/reactivity';
 import { toast } from 'svelte-sonner';
  import { copyToClipboard } from '$lib/utils/clipboard';
  import { DropdownMenu, Button } from 'sv5ui';

 let { data } = $props();
 let entries: ExperienceEntry[] = $derived(data.entries);

 let visible = $state(new Set<number>());

 let observer: IntersectionObserver | null = null;

 function observeEntry(el: HTMLElement) {
 if (!browser) return { destroy() {} };
 if (!observer) {
 observer = new IntersectionObserver(
 (obsEntries) => {
 for (const entry of obsEntries) {
 if (entry.isIntersecting) {
 const index = Number((entry.target as HTMLElement).dataset.index);
 if (!visible.has(index)) {
 visible = new Set([...visible, index]);
 }
 observer!.unobserve(entry.target);
 }
 }
 },
 { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
 );
 }
 observer.observe(el);
 return {
 destroy() {
 observer?.unobserve(el);
 }
 };
 }

  async function copyAllMarkdown() {
 try {
 const res = await fetch('/api/content/experience');
 const data = await res.json();
 const text = (data.entries as Array<Record<string, unknown>>).map((e: Record<string, unknown>) =>
 `# ${e.company || e.slug} — ${e.role}\n\n${(e.content as string).trim()}`
 ).join('\n\n---\n\n');
 if (copyToClipboard(text)) {
 toast.success('Copied all as Markdown');
 } else {
 toast.error('Failed to copy');
 }
 } catch {
 toast.error('Failed to copy');
 }
 }

  async function copyLlmstxt() {
 try {
 const res = await fetch('/api/content/experience');
 const data = await res.json();
 const text = (data.entries as Array<Record<string, unknown>>).map((e: Record<string, unknown>) => {
 const meta = e.meta as Record<string, unknown> || {};
 const company = (meta.company as string) || '';
 const role = (meta.role as string) || '';
 const lines: string[] = [`# ${company} — ${role}`, '', '---'];

 // Include all meta fields as frontmatter
 for (const [key, val] of Object.entries(meta)) {
 if (val === null || val === undefined || val === '') continue;
 if (Array.isArray(val)) {
 lines.push(`${key}:`);
 for (const item of val) {
 if (typeof item === 'object' && item !== null) {
 const obj = item as Record<string, unknown>;
 const entries = Object.entries(obj);
 if (entries.length > 0) {
 const [firstKey, firstVal] = entries[0];
 lines.push(` - ${firstKey}: ${firstVal}`);
 for (let i = 1; i < entries.length; i++) {
 const [k, v] = entries[i];
 lines.push(` ${k}: ${v}`);
 }
 }
 } else {
 lines.push(` - ${item}`);
 }
 }
 } else {
 lines.push(`${key}: ${val}`);
 }
 }

 lines.push('---', '', (e.content as string).trim(), '', '---------');
 return lines.join('\n');
 }).join('\n');

 if (copyToClipboard(text)) {
 toast.success('Copied as llms.txt');
 } else {
 toast.error('Failed to copy');
 }
 } catch {
 toast.error('Failed to copy');
 }
 }

  async function copyLlmstxtUrl() {
 try {
 if (copyToClipboard('https://woss.io/llms.txt')) {
 toast.success('URL copied');
 } else {
 toast.error('Failed to copy');
 }
 } catch {
 toast.error('Failed to copy');
 }
 }

  function formatDate(dateStr: string): string {
 const d = new Date(dateStr + '-01');
 return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
 }

 // Date range for the chart
 let timeRange = $derived(computeTimeRange(entries));

 function computeTimeRange(entries: ExperienceEntry[]) {
 const dates: number[] = [];
 for (const e of entries) {
 if (e.startDate) dates.push(new Date(e.startDate + '-01').getTime());
 if (e.endDate) dates.push(new Date(e.endDate + '-01').getTime());
 }
 dates.push(Date.now());
 const min = new SvelteDate(Math.min(...dates));
 const max = new SvelteDate(Math.max(...dates));
 min.setMonth(min.getMonth() - 6);
 max.setMonth(max.getMonth() + 6);
 return { min: min.getTime(), max: max.getTime(), span: max.getTime() - min.getTime() };
 }

 function barLeft(startDate: string): number {
 const start = new Date(startDate + '-01').getTime();
 return Math.max(0, ((start - timeRange.min) / timeRange.span) * 100);
 }

 function barWidth(endDate: string | null, startDate: string): number {
 const start = new Date(startDate + '-01').getTime();
 const end = endDate ? new Date(endDate + '-01').getTime() : Date.now();
 return Math.max(2, ((end - start) / timeRange.span) * 100);
 }

</script>

<Seo title="Experience — woss.io" description="Professional experience and work history of @woss" />

<section class="py-20 pb-24 max-md:py-16 max-md:pb-20">
 <div class="max-w-[720px] mx-auto px-6">
 <header class="flex items-center justify-between gap-4 mb-16 max-md:mb-12">
 <h1 class="font-heading text-4xl font-bold text-on-surface tracking-[-0.03em] max-md:text-3xl">Career</h1>
  <DropdownMenu
  items={[
  { label: 'Copy all as Markdown', onSelect: copyAllMarkdown },
  { label: 'Copy llms.txt URL', onSelect: copyLlmstxtUrl },
  { label: 'Copy as llms.txt', onSelect: copyLlmstxt },
  ]}
  >
  {#snippet children({ props })}
  <Button {...props} variant="outline" square size="sm" aria-label="Copy content" title="Copy content">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
  </Button>
  {/snippet}
  </DropdownMenu>
 </header>

 {#if entries.length === 0}
 <p class="text-center text-on-surface-variant text-lg py-16">No experience entries yet</p>
 {:else}
 <div class="flex flex-col gap-0 mt-12">
 {#each entries as entry, i (entry.slug + entry.startDate)}
 <div
 class="grid grid-cols-[200px_1fr] gap-4 py-4 border-b border-[rgba(255,255,255,0.08)] last:border-b-0 items-start opacity-0 translate-y-2 transition-all duration-400 max-md:grid-cols-1 max-md:gap-2 max-md:py-3"
 class:opacity-100={visible.has(i)}
 class:translate-y-0={visible.has(i)}
 use:observeEntry
 data-index={i}
 style="transition-delay: {i * 80}ms"
 >
 <div class="flex flex-col gap-px py-[2px] min-w-0">
 <span class="font-heading text-sm font-bold text-primary tracking-[-0.01em] truncate">{entry.company}</span>
 <span class="text-xs text-on-surface truncate">{entry.role}</span>
 <span class="text-xs text-on-surface-variant font-mono">
 {formatDate(entry.startDate)} &ndash; {entry.endDate ? formatDate(entry.endDate) : 'Present'}
 </span>
 </div>
 <div class="relative h-10 flex items-center max-md:h-6">
 <a
 href={resolve(`/experience/${entry.slug}`)}
 class="absolute flex items-center h-5 no-underline cursor-pointer z-10 rounded-full overflow-hidden bg-primary opacity-35 transition-all duration-250 hover:opacity-70 hover:shadow-[0_0_20px_rgba(0,218,140,0.15)] max-md:h-3"
 style="left: {barLeft(entry.startDate)}%; width: {barWidth(entry.endDate, entry.startDate)}%; mask-image: {!entry.endDate ? 'linear-gradient(to right, black 85%, transparent 100%)' : 'none'}; -webkit-mask-image: {!entry.endDate ? 'linear-gradient(to right, black 85%, transparent 100%)' : 'none'};"
 aria-label="{entry.company} &ndash; {entry.role}"
 title="{entry.company} &ndash; {entry.role}"
 >
 </a>
 </div>
 </div>
 {/each}
 </div>
 {/if}

 </div>
</section>
