<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { matchSlashCommand } from '$lib/chat/slash-commands';
  import { parse } from 'devalue';
  import { createChat as createChatApi, deleteChat as deleteChatApi } from '$lib/chat/chat-crud';
  import { USER_ID_KEY } from '$lib/chat/constants';
  import Seo from '$lib/components/Seo.svelte';

  import ChatSidebar from '$lib/components/ChatSidebar.svelte';
  import ChatInput from '$lib/components/ChatInput.svelte';
  import { config } from '$lib/config';
  import { showMobileSidebar } from '$lib/stores/mobile-sidebar';
  import ContactForm from '$lib/components/ContactForm.svelte';
  import { randomUUID } from '$lib/utils/random-uuid';
  import { toast } from 'svelte-sonner';
  import { Banner } from 'sv5ui';

  let { data } = $props();

  const MAX_CHARS = 500;
  let userId = $state('');
  let messageText = $state('');
  let isLoading = $state(false);
  let inputEl: HTMLElement | null = $state(null);

  interface Chat {
    id: string;
    userId: string;
    title: string;
    createdAt: string;
    messageCount: number;
  }

  let chats = $state<Chat[]>([]);
  let showDeleteConfirm = $state<string | null>(null);
  let deleting = $state(false);
  let hasChats = $derived(chats.length > 0);
  let canCreateChat = $derived(chats.length < config.public.maxChats);

  let ready = $state(false);
  let showContactForm = $state(true);

  function confirmDeleteChat(chatId: string): void {
    showDeleteConfirm = chatId;
  }

  async function deleteChat(chatId: string): Promise<void> {
    if (deleting) return;
    deleting = true;
    showDeleteConfirm = null;
    const ok = await deleteChatApi(userId, chatId);
    if (ok) chats = chats.filter((c) => c.id !== chatId);
    deleting = false;
  }

  $effect(() => {
    if (!browser) return;
    try {
      const stored = localStorage.getItem(USER_ID_KEY);
      if (stored) {
        userId = stored;
      } else {
        const id = randomUUID();
        localStorage.setItem(USER_ID_KEY, id);
        userId = id;
      }
    } catch {
      userId = randomUUID();
    }
  });

  onMount(() => {
    if (!userId) return;
    fetch(`/api/chat?userId=${encodeURIComponent(userId)}`)
      .then((r) => r.json())
      .then((data) => {
        chats = (data.chats as Chat[]) || [];
        ready = true;
      })
      .catch(() => {
        chats = [];
        ready = true;
      });
  });

  async function sendMessage(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || isLoading || trimmed.length > MAX_CHARS || !userId) return;

    // Intercept navigation slash commands — skip chat creation
    const matched = matchSlashCommand(trimmed);
    if (matched) {
      if (matched.name === 'show_posts') {
        goto(resolve('/posts'));
        return;
      }
      if (matched.name === 'show_experience') {
        goto(resolve('/experience'));
        return;
      }
      if (matched.name === 'about') {
        goto(resolve('/about'));
        return;
      }
      if (matched.name === 'show_chats') {
        showMobileSidebar.set(true);
        return;
      }
      // Other slash commands (contact, summarize, export) need a chat — fall through
    }

    isLoading = true;

    try {
      // Create chat first, then navigate with message as query param
      const fd = new FormData();
      fd.set('userId', userId);
      const res = await fetch('?/create', { method: 'POST', body: fd, headers: { Accept: 'application/json' } });
      const body = await res.json().catch(() => ({}));
      const actionData = body.data != null ? parse(body.data) : {};
      if (body.type === 'failure' || !actionData.id) {
        isLoading = false;
        toast.error('Failed to create chat. Please try again.');
        return;
      }
      const chatId = actionData.id as string;
      await goto(resolve(`/chat/${chatId}?q=${encodeURIComponent(trimmed)}`));
    } catch (e) {
      isLoading = false;
      console.error('Error creating chat:', e);
      toast.error('Failed to create chat.');
    }
  }

  async function createChat(): Promise<void> {
    if (!canCreateChat) return;
    const id = await createChatApi(userId);
    if (id) goto(resolve(`/chat/${id}`));
  }
</script>

<Seo title="woss.io — Ask me anything" description="Personal site of @woss — AI-powered chat and blog" />

<div class="relative overflow-hidden flex-1 flex">
  {#if ready}
    <ChatSidebar
      {chats}
      {canCreateChat}
      {showDeleteConfirm}
      bind:showMobile={$showMobileSidebar}
      oncreateChat={createChat}
      onconfirmDeleteChat={confirmDeleteChat}
      ondeleteChat={deleteChat}
      oncancelDelete={() => (showDeleteConfirm = null)}
      showDesktop={hasChats}
      oncommand={(t) => sendMessage(t)}
    />

    <div class="flex-1 flex flex-col min-w-0 max-md:px-0">
      <!-- Top: hero banner -->
      {#if data?.hero}
        <div class="px-8 max-md:px-1 pt-6 max-md:pt-3">
          <div class="w-full max-w-200 max-md:max-w-full mx-auto">
            <Banner
              title={data.hero.title}
              icon="lucide:sparkles"
              color="primary"
              to={resolve('/posts/[slug]', { slug: data.hero.slug })}
              class="rounded-lg"
              ui={{ container: 'min-h-24' }}
              actions={[{ label: 'Read now', variant: 'solid', color: 'surface', size: 'sm', href: resolve('/posts/[slug]', { slug: data.hero.slug }) }]}
            />
          </div>
        </div>
      {/if}

      <!-- Middle: chat + suggested questions or contact form (centered) -->
      <div
        class="flex-1 flex flex-col items-center justify-center gap-6 px-8 max-md:px-1 max-md:pb-3 max-md:justify-end"
      >
        {#if canCreateChat}
          <div class="w-full max-w-200 flex flex-col gap-5">
            <ChatInput
              bind:messageText
              bind:isLoading
              bind:inputEl
               onsend={sendMessage}
              variant="home"
            />
          </div>
        {:else}
          <!-- Contact form when chats exhausted -->
          <main class="flex-1 flex flex-col items-center justify-center gap-8 max-md:gap-6 px-4">
            <div class="w-full max-w-105 flex flex-col items-center gap-6">
              <!-- Card wrapper -->
              <div
                class="w-full rounded-2xl bg-surface-container-high border border-[rgba(255,255,255,0.06)] p-8 max-md:p-6 flex flex-col items-center gap-6"
              >
                <div class="text-center">
                  <div class="size-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--color-primary)"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>
                  <p class="font-heading text-xl text-on-surface m-0">No more chats available!</p>
                  <p class="font-body text-sm text-on-surface-variant mt-2 m-0 max-w-[320px] mx-auto">
                    It seems you are interested in my work. Drop your details and I'll get back to you.
                  </p>
                </div>

                <ContactForm bind:showContactForm {userId} chatId="" contactDismissed={false} noHeader />
              </div>
            </div>
          </main>
        {/if}
      </div>

      <!-- Bottom: featured posts -->
      <!-- {#if featuredReady && data?.featuredPosts?.length}
        <div class="px-8 max-md:px-4 pb-12 pt-2">
          <div class="w-full max-w-200 mx-auto">
            <div class="flex flex-col gap-3">
              <h2 class="font-body text-xs font-semibold text-on-surface-variant uppercase tracking-wider m-0">
                Featured Posts
              </h2>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                {#each (data?.featuredPosts ?? []).slice(-3) as post (post.slug)}
                  <a
                    href={resolve('/posts/[slug]', { slug: post.slug })}
                    class="flex flex-col gap-2 rounded-xl bg-surface-container-high border border-[rgba(255,255,255,0.06)] p-4 no-underline transition-all duration-150 hover:border-primary/30 hover:shadow-[0_0_20px_rgba(0,218,140,0.06)] hover:-translate-y-0.5"
                  >
                    {#if post.headerImage}
                      <div class="w-full aspect-video rounded-lg overflow-hidden bg-surface-container">
                        <img src={post.headerImage.url} alt={post.headerImage.alt} width="640" height="360" class="size-full object-cover" />
                      </div>
                    {/if}
                    <div class="flex flex-col gap-1 min-w-0">
                      <h3 class="font-body text-sm font-semibold text-on-surface m-0 line-clamp-2">{post.title}</h3>
                      {#if post.description}
                        <p class="font-body text-xs text-on-surface-variant m-0 line-clamp-2">{post.description}</p>
                      {/if}
                      <div class="flex items-center gap-2 mt-1">
                        {#if post.date}
                          <span class="font-mono text-[10px] text-on-surface-variant"
                            >{new Date(post.date).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}</span
                          >
                        {/if}
                        {#each post.tags.slice(0, 2) as tag (tag)}
                          <span class="font-mono text-[10px] text-primary/60 bg-primary/5 px-1.5 py-0.5 rounded-full"
                            >{tag}</span
                          >
                        {/each}
                      </div>
                    </div>
                  </a>
                {/each}
              </div>
            </div>
          </div>
        </div>
      {/if} -->
    </div>
  {:else}
    <div class="relative z-2"></div>
  {/if}
</div>
