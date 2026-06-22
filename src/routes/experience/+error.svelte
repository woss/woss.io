<script lang="ts">
 import { resolve } from '$app/paths';
 // eslint-disable-next-line svelte/valid-prop-names-in-kit-pages
 let { error } = $props();
 let status = $derived(error?.status ?? 404);
 let message = $derived(error?.body?.message || error?.message || 'Not found');

 let visible = $state(false);
 $effect(() => {
 const raf = requestAnimationFrame(() => { visible = true; });
 return () => cancelAnimationFrame(raf);
 });
</script>

<svelte:head>
 <title>{status} — woss</title>
</svelte:head>

<section class="py-20 pb-24 opacity-0 translate-y-4 transition-all duration-500"
 class:opacity-100={visible}
 class:translate-y-0={visible}
>
 <div class="max-w-(--width-prose) mx-auto px-4">
 <article class="bg-surface-container border border-[rgba(255,255,255,0.08)] rounded-lg p-8 text-center">
 <!-- Status code big & bold -->
 <p class="font-mono text-6xl font-bold text-primary m-0 mb-2">{status}</p>
 
 <!-- Decorative gradient line -->
 <div class="h-[2px] bg-[linear-gradient(90deg,var(--color-primary),var(--color-secondary))] rounded-[1px] my-6 max-w-[120px] mx-auto" aria-hidden="true"></div>
 
 <!-- Error message -->
 <p class="font-body text-lg text-on-surface mb-2">
 {#if status === 404}
 This page doesn't exist.
 {:else}
 {message}
 {/if}
 </p>
 <p class="font-body text-sm text-on-surface-variant mb-8">
 The experience entry you're looking for might have been moved or removed.
 </p>
 
 <!-- Back link -->
 <a
 href={resolve('/experience')}
 class="inline-flex items-center gap-2 px-6 py-3 font-body text-sm font-medium text-surface bg-primary border-0 rounded-lg cursor-pointer no-underline transition-all duration-200 hover:shadow-[0_0_24px_rgba(0,218,140,0.2)] hover:scale-[1.02] active:scale-[0.98]"
 >
 ← Back to Experience
 </a>
 </article>
 </div>
</section>
