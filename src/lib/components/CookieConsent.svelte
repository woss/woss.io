<script lang="ts">
  import { resolve } from '$app/paths';
  import { Button } from 'sv5ui';

  let { onaccept, ondecline }: { onaccept: () => void; ondecline: () => void } = $props();
</script>

<div
  role="dialog"
  aria-label="Cookie consent"
  class="fixed bottom-0 inset-x-0 z-50 p-4 bg-surface/95 backdrop-blur-md border-t border-[rgba(255,255,255,0.08)] shadow-lg"
>
  <div class="mx-auto max-w-3xl flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6">
    <p class="text-sm text-on-surface-variant m-0 flex-1">
      This site uses Datadog RUM for performance monitoring and session replay.
      <a href={resolve('/privacy')} class="text-secondary underline hover:text-primary transition-colors">
        Learn more
      </a>
    </p>
    <div class="flex items-center gap-3 shrink-0">
      <Button variant="ghost" size="sm" onclick={ondecline}>
        Decline
      </Button>
      <Button variant="solid" color="primary" size="sm" onclick={onaccept}>
        Accept
      </Button>
    </div>
  </div>
</div>
