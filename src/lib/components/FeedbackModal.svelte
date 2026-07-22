<script lang="ts">
  import { Modal, Textarea, Button } from 'sv5ui';

  let {
    open = $bindable(false),
    reactionType = 'up',
    onSubmit = () => {},
  }: {
    open: boolean;
    reactionType?: 'up' | 'down';
    onSubmit?: (reason: string) => void;
  } = $props();

  let reason = $state('');

  function handleSubmit(): void {
    const trimmed = reason.trim();
    onSubmit(trimmed);
    reason = '';
    open = false;
  }

  function handleSkip(): void {
    onSubmit('');
    reason = '';
    open = false;
  }

  function handleDismiss(): void {
    onSubmit('');
    reason = '';
    open = false;
  }

  const heading = $derived(
    reactionType === 'up' ? "What's working well?" : "What was missing or incorrect?",
  );
</script>

<Modal bind:open title={heading} size="sm" close dismissible onOpenChange={(o) => { if (!o) handleDismiss(); }}>
  {#snippet body()}
    <p class="text-sm text-on-surface-variant mb-3">
      {reactionType === 'up'
        ? 'Optional: help us understand what you found helpful.'
        : 'Optional: tell us what was missing or incorrect.'}
    </p>
    <Textarea
      placeholder="Your feedback (optional)"
      bind:value={reason}
      rows={3}
      class="w-full resize-none"
    />
  {/snippet}
  {#snippet footer()}
    <div class="flex items-center gap-2">
      <Button variant="solid" color="primary" size="sm" onclick={handleSubmit}>
        Send feedback
      </Button>
      {#if reactionType === 'up'}
        <Button variant="ghost" size="sm" onclick={handleSkip}>
          Skip
        </Button>
      {/if}
    </div>
    {#if reactionType === 'down'}
      <p class="text-xs text-on-surface-variant mt-2">
        Your message will be removed.
      </p>
    {/if}
  {/snippet}
</Modal>
