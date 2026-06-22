<script lang="ts">
  let {
    servers = [] as Array<{ id: string; label?: string; connected: boolean }>,
  }: {
    servers?: Array<{ id: string; label?: string; connected: boolean }>;
  } = $props();
</script>

{#if servers.length > 0}
  <div class="px-3 pt-3 pb-1">
    <p class="text-xs font-mono uppercase tracking-wider text-outline">Services</p>
  </div>
  <div class="px-3 pb-3 space-y-1">
    {#each servers as server (server.id)}
      <div class="flex items-center justify-between">
        <span class="font-mono text-xs text-on-surface-variant truncate">{server.label || server.id}</span>
        <span class="size-1.5 rounded-full shrink-0 {server.connected ? 'bg-[#00da8c]' : 'bg-secondary'}"></span>
      </div>
    {/each}
  </div>
{/if}
