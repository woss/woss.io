<script lang="ts">
  import { Button } from 'sv5ui';
  import { copyToClipboard } from '$lib/utils/clipboard';
  import { toast } from 'svelte-sonner';

  let {
    text,
    toastMessage = 'Copied to clipboard',
    label = 'Copy',
    class: className = '',
    oncopy,
    square = true,
  }: {
    text: string;
    toastMessage?: string;
    label?: string;
    class?: string;
    oncopy?: () => boolean;
    square?: boolean;
  } = $props();

  function handle() {
    const success = oncopy ? oncopy() : copyToClipboard(text);
    if (success) {
      toast.success(toastMessage);
    } else {
      toast.error('Failed to copy');
    }
  }
</script>

{#if square}
  <Button onclick={handle} variant="outline" square size="sm" aria-label={label} title={label} class={className}>
    <svg class="block" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  </Button>
{:else}
  <Button onclick={handle} variant="outline" size="sm" class={className}>
    <svg class="inline-block shrink-0 align-middle mr-1.5" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
    {label}
  </Button>
{/if}
