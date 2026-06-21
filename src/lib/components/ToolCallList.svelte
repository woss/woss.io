<script lang="ts">
  let {
    tools = [] as Array<{
      id: string;
      name: string;
      serverId: string;
      startedAt: number;
      finishedAt?: number;
    }>,
    now = Date.now(),
  }: {
    tools: Array<{ id: string; name: string; serverId: string; startedAt: number; finishedAt?: number }>;
    now?: number;
  } = $props();

  function formatDuration(ms: number): string {
    if (ms <= 0) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function toolIcon(name: string): string {
    if (name.includes('search') || name.includes('fetch')) return '🔍';
    if (name.includes('read') || name.includes('list')) return '📄';
    if (name.includes('write') || name.includes('create')) return '✏️';
    return '⚙';
  }
</script>

{#if tools.length > 0}
  <div class="mt-4 space-y-1 overflow-hidden">
    {#each tools as tool (tool.id)}
      <div
        class="flex items-center gap-2.5 px-3 py-2 rounded-lg border {tool.finishedAt
          ? 'bg-surface-container/20 border-outline-variant/10 animate-tool-fade-out'
          : 'bg-surface-container/40 border-primary/10'}"
      >
        <span
          class="shrink-0 size-2 rounded-full {tool.finishedAt
            ? 'bg-success'
            : 'bg-warning animate-pulse-dot'}"
          aria-hidden="true"
        ></span>
        <span class="shrink-0 text-xs">{toolIcon(tool.name)}</span>
        <span class="truncate text-xs font-mono text-on-surface-variant"
          >{tool.serverId}/{tool.name}</span
        >
        <span class="tabular-nums text-xs font-mono text-outline/60 ml-auto shrink-0"
          >{formatDuration(
            Math.abs((tool.finishedAt ?? now) - tool.startedAt),
          )}</span
        >
        <span
          class="text-[10px] font-mono {tool.finishedAt
            ? 'text-success/60'
            : 'text-warning'} shrink-0"
          >{tool.finishedAt ? 'done' : '…'}</span
        >
      </div>
    {/each}
  </div>
{/if}
