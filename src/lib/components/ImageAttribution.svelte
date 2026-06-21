<script lang="ts">
  let {
    title = '',
    creator = '',
    license = '',
    dataMining = '',
    maculaUrl = '',
  }: {
    title?: string;
    creator?: string;
    license?: string;
    dataMining?: string;
    maculaUrl?: string;
  } = $props();

  let line1 = $derived.by(() => {
    if (title && creator) return `${title} by ${creator}`;
    if (title) return title;
    if (creator) return `by ${creator}`;
    return '';
  });

  let line2 = $derived.by(() => {
    const parts: string[] = [];
    if (license) parts.push(license);
    if (dataMining) parts.push(`Data mining: ${dataMining}`);
    return parts.join(' · ');
  });

  let showLine2 = $derived(!!(license || dataMining));
</script>

<div
  class="absolute bottom-4 right-4 z-2 bg-black/50 backdrop-blur-sm px-2.5 py-1.5 rounded-md text-[10px] text-white/70 font-mono leading-tight flex flex-col gap-0.5 pointer-events-none select-none"
>
  {#if line1}
    <div class="text-white/90">
      {#if maculaUrl}
        <!-- eslint-disable svelte/no-navigation-without-resolve -->
        <a
          href={maculaUrl}
          target="_blank"
          rel="noopener"
          class="text-white/90 hover:text-white transition-colors duration-150 pointer-events-auto">{line1}</a
        >
        <!-- eslint-enable svelte/no-navigation-without-resolve -->
      {:else}
        {line1}
      {/if}
    </div>
  {/if}
  {#if showLine2}
    <div>{line2}</div>
  {/if}
</div>
