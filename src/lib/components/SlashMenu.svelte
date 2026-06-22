<script lang="ts">
  import { SLASH_COMMANDS } from '$lib/chat/slash-commands';

  let {
  show = false,
  commands = [] as typeof SLASH_COMMANDS,
  selectedIndex = 0,
  onselect = () => {},
  onmouseenter = () => {},
  } = $props();
</script>

{#if show && commands.length > 0}
  <div
  class="absolute bottom-full inset-x-0 mb-2 bg-surface-container-high border border-[rgba(255,255,255,0.08)] rounded-xl max-h-[40vh] max-md:max-h-[35vh] overflow-y-auto shadow-[0_-4px_24px_rgba(0,0,0,0.3)] z-50"
  >
  <div class="px-3 py-2 border-b border-[rgba(255,255,255,0.06)]">
  <span class="font-heading text-[11px] uppercase tracking-widest text-outline">Commands</span>
  </div>
  {#each commands as cmd, i (cmd.triggers[0])}
  <button
   class="flex items-center justify-between w-full px-4 py-2.5 text-left bg-transparent border-0 cursor-pointer transition-all duration-100"
  class:bg-[rgba(56,189,248,0.15)]={i === selectedIndex}
  style={i === selectedIndex ? 'border-left:2px solid rgba(56,189,248,0.5)' : ''}
  onmouseenter={() => { onmouseenter(i); }}
  onclick={() => onselect(cmd.triggers[0])}
  onkeydown={(e) => { if (e.key === 'Enter') onselect(cmd.triggers[0]); }}
  >
  <span class="font-mono text-sm text-primary font-semibold">{cmd.triggers[0]}</span>
  <span
   class="font-body text-xs text-right"
  class:text-on-surface-variant={i !== selectedIndex}
  class:text-on-surface={i === selectedIndex}
  >{cmd.description}</span>
  </button>
  {/each}
  </div>
{/if}
