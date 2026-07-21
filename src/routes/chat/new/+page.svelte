<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import { enhance } from '$app/forms';
  import { USER_ID_KEY, getUserId } from '$lib/chat/constants';
  import { randomUUID } from '$lib/utils/random-uuid';

  let error = $state<string | null>(null);
  let userId = $state<string | null>(null);
  let formEl: HTMLFormElement = $state.raw()!;

  $effect(() => {
    if (!browser) return;

    let id = getUserId();
    if (!id) {
      id = randomUUID();
      localStorage.setItem(USER_ID_KEY, id);
    }

    userId = id;
  });

  $effect(() => {
    if (userId && formEl) {
      formEl.requestSubmit();
    }
  });
</script>

<svelte:head>
  <title>New Chat — woss</title>
</svelte:head>

<div class="flex-1 flex items-center justify-center bg-surface min-h-screen">
  {#if error}
    <div class="text-center px-8">
      <p class="text-on-surface-variant text-sm">{error}</p>
    </div>
  {:else}
    <form
      method="POST"
      action="/chat?/create"
      use:enhance={() => {
        return async ({ result }) => {
          if (result.type === 'success' && result.data?.id) {
            const data = result.data as Record<string, unknown>;
            const chatId = String(data.id);
            const question = page.url.searchParams.get('q') ?? '';
            const path = question
              ? resolve(`/chat/${chatId}?q=${encodeURIComponent(question)}`)
              : resolve(`/chat/${chatId}`);
            goto(path);
          } else if (result.type === 'failure') {
            const data = result.data as Record<string, unknown> | undefined;
            error = (typeof data?.error === 'string' ? data.error : null) ?? 'Failed to create chat';
          } else {
            goto(resolve('/chat'));
          }
        };
      }}
      bind:this={formEl}
    >
      {#if userId}
        <input type="hidden" name="userId" value={userId} />
      {/if}
    </form>
    <div class="flex flex-col items-center gap-4">
      <span class="loading loading-spinner loading-md text-primary"></span>
      <p class="text-on-surface-variant text-sm">Creating new chat...</p>
    </div>
  {/if}
</div>
