<script lang="ts">
  import { SLASH_COMMANDS } from '$lib/chat/slash-commands';
  import { Accordion } from 'sv5ui';

  let {
    oncommand = () => {},
    onclose = () => {},
  }: {
    oncommand?: (trigger: string) => void;
    onclose?: () => void;
  } = $props();
</script>

<div class="p-2">
  <div class="relative p-3">
    <!-- Border glow -->
    <div
      class="absolute -inset-1 rounded-xl pointer-events-none"
      style="border: 1px solid rgba(56,189,248,0.3); animation: border-glow 4s ease-in-out infinite;"
    ></div>

    <!-- Ambient glow -->
    <div
      class="absolute inset-0 rounded-xl pointer-events-none"
      style="animation: ambient-pulse 5s ease-in-out infinite; background: radial-gradient(ellipse at center, rgba(56,189,248,0.12) 0%, rgba(168,85,247,0.08) 40%, transparent 70%);"
    ></div>

    <Accordion
      items={[{ label: 'Slash Commands', value: 'slash-commands' }]}
      type="single"
      ui={{
        trigger: 'text-xs font-mono uppercase tracking-wider text-outline',
        body: 'pt-1 pb-2',
        root: 'w-full',
        item: 'border-0',
      }}
    >
      {#snippet content()}
        <div class="space-y-1">
          {#each SLASH_COMMANDS as cmd (cmd.triggers[0])}
            <button
              class="w-full flex items-center justify-between px-2 py-1.5 rounded text-left text-xs transition-colors hover:bg-surface-container-high/50"
              onclick={() => {
                oncommand(cmd.triggers[0]);
                onclose();
              }}
            >
              <span class="font-mono text-primary">{cmd.triggers[0]}</span>
              <span class="text-on-surface-variant text-right">{cmd.description}</span>
            </button>
          {/each}
        </div>
      {/snippet}
    </Accordion>
  </div>
</div>
