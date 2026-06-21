<script lang="ts">
  import { toast } from 'svelte-sonner';
  import { copyToClipboard } from '$lib/utils/clipboard';
  import { Accordion, Input } from 'sv5ui';
  import CopyComponent from '$lib/components/CopyComponent.svelte';

  type PlaceholderDef = {
    key: string;
    label: string;
    hint?: string;
  };

  type WorkflowFileDef = {
    label: string;
    json: string;
    placeholders: PlaceholderDef[];
  };

  let {
    workflowFiles,
  }: {
    workflowFiles: WorkflowFileDef[];
  } = $props();

  function copy(index: number): boolean {
    const wf = workflowFiles[index];
    let result = wf.json;
    const inputs = document.querySelectorAll<HTMLInputElement>(
      `[data-replacer-input="${index}"]`,
    );
    const unfilled: string[] = [];
    inputs.forEach((input) => {
      const key = input.dataset.key || '';
      const val = input.value.trim();
      if (!val) {
        unfilled.push(key);
        return;
      }
      const re = new RegExp(escapeRegex(key), 'g');
      result = result.replace(re, val);
    });

    if (unfilled.length > 0) {
      toast.warning(`Unfilled: ${unfilled.join(', ')} — copying anyway`);
    }

    return copyToClipboard(result);
  }

  function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function formatJson(str: string): string {
    try {
      return JSON.stringify(JSON.parse(str), null, 2);
    } catch {
      return str;
    }
  }
</script>

<div class="workflow-replacer space-y-6">
  {#each workflowFiles as wf, i (i)}
    <div class="wf-card bg-surface-container border border-[rgba(255,255,255,0.08)] rounded-lg overflow-hidden">
      <h3 class="text-sm font-mono font-semibold text-secondary uppercase tracking-[0.08em] px-4 pt-4 pb-0 m-0">
        {wf.label}
      </h3>

      <!-- JSON preview (collapsible) -->
      <Accordion
        items={[{ label: 'Preview JSON', value: 'json' }]}
        type="single"
        ui={{ trigger: 'text-xs font-mono text-on-surface-variant', root: 'w-full px-4 py-2', item: 'border-0' }}
      >
        {#snippet content()}
          <pre
            class="mt-2 p-3 rounded-md bg-[rgba(0,0,0,0.3)] text-xs/relaxed overflow-auto max-h-64 font-mono text-slate-300"
><code>{formatJson(wf.json)}</code></pre>
        {/snippet}
      </Accordion>

      <!-- Placeholder inputs -->
      <div class="px-4 pb-3 space-y-3">
        {#each wf.placeholders as ph (ph.key)}
          <div class="flex flex-col gap-1">
            <label
              for="replacer-{i}-{ph.key}"
              class="text-xs font-mono text-on-surface-variant"
            >
              {ph.label}
              {#if ph.hint}
                <span class="text-[10px] text-on-surface-variant/60">— {ph.hint}</span>
              {/if}
            </label>
            <Input
              id="replacer-{i}-{ph.key}"
              data-replacer-input={i}
              data-key={ph.key}
              type="text"
              value={ph.key}
              variant="outline" size="sm"
              class="font-mono text-xs"
            />
          </div>
        {/each}
      </div>

      <!-- Copy button -->
      <div class="px-4 pb-4">
        <CopyComponent
          text={wf.json}
          toastMessage="Workflow JSON copied to clipboard"
          label="copy workflow"
          square={false}
          oncopy={() => copy(i)}
        />
      </div>
    </div>
  {/each}
</div>
