<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import { createChat as createChatApi } from '$lib/chat/chat-crud';
  import { USER_ID_KEY, getUserId } from '$lib/chat/constants';
  import { randomUUID } from '$lib/utils/random-uuid';

  let error = $state<string | null>(null);

  $effect(() => {
    if (!browser) return;

    let userId: string | null = getUserId();
    if (!userId) {
      userId = randomUUID();
      localStorage.setItem(USER_ID_KEY, userId);
    }

    const question = page.url.searchParams.get('q') ?? '';

    createChatApi(userId).then((result) => {
      if (result.id) {
        const path = question
          ? resolve(`/chat/${result.id}?q=${encodeURIComponent(question)}`)
          : resolve(`/chat/${result.id}`);
        goto(path);
      } else {
        error = result.error ?? null;
      }
    });
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
    <div class="flex flex-col items-center gap-4">
      <span class="loading loading-spinner loading-md text-primary"></span>
      <p class="text-on-surface-variant text-sm">Creating new chat...</p>
    </div>
  {/if}
</div>
