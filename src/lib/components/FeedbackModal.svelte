<script lang="ts">
  import { Button, Textarea } from 'sv5ui';
  import { toast } from 'svelte-sonner';

  let {
    open = $bindable(false),
    type = 'up' as 'up' | 'down',
    messageId = '',
    userId = '',
    chatId = '',
    onreport = () => {},
    onskip = () => {},
  }: {
    open: boolean;
    type: 'up' | 'down';
    messageId: string;
    userId: string;
    chatId: string;
    onreport: () => void;
    onskip: () => void;
  } = $props();

  let reason = $state('');
  let isSubmitting = $state(false);
  let reasonError = $state('');

  function reset(): void {
    reason = '';
    reasonError = '';
    isSubmitting = false;
  }

  function close(): void {
    open = false;
    reset();
    onskip();
  }

  function handleBackdropClick(e: PointerEvent): void {
    if (e.target === e.currentTarget) close();
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') close();
  }

  async function handleSubmit(): Promise<void> {
    if (type === 'down' && !reason.trim()) {
      reasonError = 'Please provide a reason for your feedback.';
      return;
    }
    reasonError = '';
    isSubmitting = true;

    try {
      if (type === 'up') {
        const fd = new FormData();
        fd.append('messageId', messageId);
        fd.append('userId', userId);
        fd.append('mode', 'set');
        fd.append('reactionType', 'up');
        fd.append('reason', reason);
        await fetch(`/chat/${chatId}?/reaction`, { method: 'POST', body: fd });
        toast.success('Thanks for the feedback!');
        open = false;
        reset();
      } else {
        const fd = new FormData();
        fd.append('messageId', messageId);
        fd.append('userId', userId);
        fd.append('reason', reason);
        await fetch(`/chat/${chatId}?/report`, { method: 'POST', body: fd });
        toast.success('Report submitted. Message removed.');
        open = false;
        reset();
        onreport();
      }
    } catch (err) {
      console.error('Feedback submission failed:', err);
      toast.error('Something went wrong. Please try again.');
    } finally {
      isSubmitting = false;
    }
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
    onpointerdown={handleBackdropClick}
    onkeydown={handleKeydown}
  >
    <div
      class="relative w-full max-w-sm rounded-xl bg-white p-6 shadow-xl dark:bg-[#1a1a2e]"
      role="dialog"
      aria-modal="true"
      aria-label={type === 'up' ? 'Helpful feedback' : 'Not helpful feedback'}
    >
      <!-- Close button -->
      <button
        type="button"
        class="absolute right-3 top-3 flex size-7 items-center justify-center rounded-full text-on-surface-variant/60 hover:bg-black/5 hover:text-on-surface-variant dark:hover:bg-white/10"
        onclick={close}
        aria-label="Close"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <!-- Icon -->
      <div class="mb-4 flex items-center justify-center">
        <div class="flex size-10 items-center justify-center rounded-full {type === 'up' ? 'bg-primary/10 text-primary' : 'bg-secondary/10 text-secondary'}">
          {#if type === 'up'}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z" />
            </svg>
          {:else}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 14V2" /><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z" />
            </svg>
          {/if}
        </div>
      </div>

      <!-- Title -->
      <h3 class="mb-1 text-center font-heading text-base text-on-surface dark:text-white">
        {type === 'up' ? 'Helpful' : 'Not helpful'}
      </h3>

      <!-- Subtitle -->
      <p class="mb-5 text-center text-sm text-on-surface-variant">
        {type === 'up'
          ? 'Glad this was useful! Want to add any context?'
          : 'What went wrong? Your feedback helps improve responses.'}
      </p>

      <!-- Textarea -->
      <Textarea
        placeholder={type === 'up' ? 'Anything else to add? (optional)' : 'What could be improved? (required)'}
        bind:value={reason}
        rows={3}
        class="mb-1 w-full resize-none"
      />
      {#if reasonError}
        <p class="mb-3 text-xs text-secondary">{reasonError}</p>
      {/if}

      <!-- Buttons -->
      <div class="mt-4 flex items-center justify-end gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          label="Skip"
          leadingIcon="lucide:x"
          onclick={close}
        />
        <Button
          type="button"
          variant="solid"
          color="primary"
          loading={isSubmitting}
          disabled={isSubmitting}
          label={type === 'up' ? 'Send feedback' : 'Send report'}
          leadingIcon="lucide:send"
          onclick={handleSubmit}
        />
      </div>
    </div>
  </div>
{/if}
