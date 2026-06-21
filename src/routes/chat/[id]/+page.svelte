<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { config } from '$lib/config';
  import MsgCard from '$lib/components/ChatMessage.svelte';
  import ChatSidebar from '$lib/components/ChatSidebar.svelte';
  import ContactForm from '$lib/components/ContactForm.svelte';
  import ChatInput from '$lib/components/ChatInput.svelte';
  import RightSidebar from '$lib/components/RightSidebar.svelte';
  import { toast } from 'svelte-sonner';
  import { playPluckSound } from '$lib/utils/sounds';
  import { randomUUID } from '$lib/utils/random-uuid';
  import { SUGGESTED_QUESTIONS } from '$lib/chat/suggested-questions';
  import { CONTACT_DISMISSED_KEY } from '$lib/chat/constants';
  import { Button } from 'sv5ui';
  import FeatureTour from '$lib/components/FeatureTour.svelte';
  import { TOUR_DEFINITIONS } from '$lib/chat/tour-config';
  import type { TourDefinition } from '$lib/chat/tour-config';

  import type { ChatMessage, Chat, ToolCallInfo, Source } from '$lib/chat/types';
  import { matchSlashCommand } from '$lib/chat/slash-commands';
  import { sendChatMessage } from '$lib/chat/send';
  import { appendQueryParams } from '$lib/utils/utm';
  import {
    connectSSE,
    disconnectSSE,
    resetStreamingState,
    sseState,
    getActiveToolCount,
    getCompletedToolCount,
  } from '$lib/stores/chat-sse.svelte';
  import { createChat as createChatApi, deleteChat as deleteChatApi } from '$lib/chat/chat-crud';
  import { USER_ID_KEY } from '$lib/chat/constants';
  import { SvelteMap } from 'svelte/reactivity';

  let { data } = $props() as { data: { messages: ChatMessage[]; locked: boolean; chatOwnerId?: string } };

  /* ─── Constants ─── */

  let ORIGINAL_FAV_HREF = $derived(appendQueryParams('https://u.macula.link/@woss/avatar', page.data.queryParams));
  const LOADING_FAV_SVG = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
 <circle cx="16" cy="16" r="15" fill="#1a1a2e"/>
 <circle cx="16" cy="16" r="5" fill="#22c55e">
 <animate attributeName="opacity" values="1;0.2;1" dur="1.5s" repeatCount="indefinite"/>
 <animate attributeName="r" values="5;7;5" dur="1.5s" repeatCount="indefinite"/>
 </circle>
 </svg>`,
  );
  const LOADING_FAVICON = `data:image/svg+xml,${LOADING_FAV_SVG}`;

  /* ─── Route params ─── */

  let chatId = $derived((page.params as { id: string }).id || null);
  let queryText = $state('');

  /* ─── State ─── */

  let userId = $state('');
  let dismissedFeatures: string[] = $state([]);
  let activeTour: TourDefinition | undefined = $state();
  // svelte-ignore state_referenced_locally
  const initialMessages = Array.isArray(data?.messages) ? data.messages : [];
  let messages: ChatMessage[] = $state(initialMessages);
  let sidebarMessageId = $state<string | null>(null);
  let sidebarTab = $state<'sources' | 'tools'>('sources');
  let sidebarVisible = $state(false);
  let attemptsLeft = $state(0);

  function openSidebar(messageId: string, tab: 'sources' | 'tools'): void {
    sidebarMessageId = messageId;
    sidebarTab = tab;
    sidebarVisible = true;
  }

  function closeSidebar(): void {
    sidebarVisible = false;
    sidebarMessageId = null;
  }

  let sidebarMessage = $derived.by(() => {
    return messages.find((m) => m.id === sidebarMessageId) || null;
  });

  let messageText = $state('');
  let isLoading = $state(false);
  let lastSentText = $state('');
  let inputEl: HTMLDivElement | null = $state(null);
  let messageListEl: HTMLDivElement | undefined = $state();
  let stickToBottom = $state(true);
  let bottomSentinelEl: HTMLDivElement | undefined = $state();
  let scrollRAF = 0;
  let showMobile = $state(false);
  /* ─── Chat state ─── */

  // Capture SSR data at component init — page params are available here
  // svelte-ignore state_referenced_locally
  const ssrLocked = data.locked;
  const ssrChatId = (page.params as { id: string }).id;

  let chats = $state<Chat[]>(
    ssrLocked && ssrChatId
      ? [{ id: ssrChatId, userId: '', title: '', createdAt: '', messageCount: 0, locked: true }]
      : [],
  );
  let chatsLoaded = $state(false);

  // Close mobile sidebar when switching to a different chat
  $effect(() => {
    void chatId;
    showMobile = false;
  });

  // Pulse green-dot favicon while loading
  $effect(() => {
    if (isLoading) {
      const el = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (el) {
        el.href = LOADING_FAVICON;
        return () => {
          el.href = ORIGINAL_FAV_HREF;
        };
      }
    }
  });

  let showContactForm = $state(false);
  let contactDismissed = $state(false);
  let showDeleteConfirm = $state<string | null>(null);
  let deleting = $state(false);

  /* ─── Tool call state ─── */

  /* ─── Streaming state (SSE events) ─── */

  let now = $state(Date.now());

  /* ─── Derived ─── */

  let hasMessages = $derived(messages.length > 0);
  let currentChat = $derived(chats.find((c) => c.id === chatId) ?? null);
  let currentChatTitle = $derived(currentChat?.title ?? '');
  let chatCount = $derived(chats.length);
  let canCreateChat = $derived(chatCount < config.public.maxChats);
  let userMessageCount = $derived(messages.filter((m) => m.role === 'user').length);
  let maxMessagesReached = $derived(userMessageCount >= config.public.maxMessages);

  let streamingToolValues = $derived(Object.values(sseState.streamingToolCalls));
  let activeToolCount = $derived(getActiveToolCount());
  let completedToolCount = $derived(getCompletedToolCount());

  /* ─── Functions ─── */

  function focusInput(): void {
    inputEl?.focus({ preventScroll: true });
  }

  async function loadChats(): Promise<void> {
    if (!userId) return;
    try {
      const res = await fetch(`/api/chat?userId=${userId}`);
      if (res.ok) {
        chats = (await res.json()).chats;
      }
    } catch {
      /* ignore */
    }
    chatsLoaded = true;
  }

  async function loadMessages(): Promise<void> {
    if (!chatId) return;
    stickToBottom = true;
    try {
      const res = await fetch(`/api/chat/${chatId}/messages`);
      if (res.ok) {
        const data = await res.json();

        // Guard: if server has no messages but local state already populated
        // (e.g. user sent a message before this fetch resolved), don't overwrite.
        if (isLoading && messages.length > 0 && data.messages.length <= messages.length) return;

        // Fetch reactions for assistant messages BEFORE mapping into $state
        // so reaction data is baked into the initial objects — avoids post-mutation
        // reactivity issues with $state + .filter()-derived arrays.
        const rawAssistantMessages = data.messages.filter((m: Record<string, unknown>) => m.role === 'assistant');
        const reactionPromises = rawAssistantMessages.map((m: Record<string, unknown>) =>
          fetchReaction(m.id as string),
        );
        const reactionResults = await Promise.allSettled(reactionPromises);
        const reactionMap = new SvelteMap<string, { type: 'up' | 'down' | 'heart'; reason: string }>();
        for (let i = 0; i < rawAssistantMessages.length; i++) {
          const result = reactionResults[i];
          if (result.status === 'fulfilled' && result.value) {
            reactionMap.set(rawAssistantMessages[i].id as string, result.value);
          }
        }

        // Map messages with reactions included
        messages = data.messages.map((m: Record<string, unknown>) => ({
          id: m.id as string,
          role: m.role as 'user' | 'assistant',
          text: m.content as string,
          error: m.error as string | undefined,
          irrecoverable: m.irrecoverable as boolean | undefined,
          queryType: (m.queryType as string) || undefined,
          sources: m.sources as Source[] | undefined,
          timestamp: new Date(m.createdAt as string).getTime() || Date.now(),
          createdAt: m.createdAt as string,
          tokensIn: (m.tokensIn as number) || 0,
          tokensOut: (m.tokensOut as number) || 0,
          durationMs: (m.durationMs as number) || 0,
          deletedAt: m.deletedAt as string | undefined,
          toolCalls: (m.toolCalls as ToolCallInfo[]) || [],
          reaction: reactionMap.get(m.id as string) || (m.reaction as ChatMessage['reaction']) || undefined,
          savedReason: reactionMap.get(m.id as string)?.reason || (m.savedReason as string) || undefined,
        }));
      }
    } catch {
      /* ignore */
    }
  }

  async function createChat(): Promise<void> {
    if (!canCreateChat) return;
    const id = await createChatApi(userId, '/chat');
    if (id) goto(resolve(`/chat/${id}`));
  }

  function confirmDeleteChat(id: string): void {
    showDeleteConfirm = id;
  }

  async function deleteChat(id: string): Promise<void> {
    if (deleting) return;
    deleting = true;
    showDeleteConfirm = null;
    const ok = await deleteChatApi(userId, id);
    if (ok) {
      chats = chats.filter((c) => c.id !== id);
      if (chatId === id) {
        if (chats.length > 0) {
          goto(resolve(`/chat/${chats[0].id}`));
        } else {
          goto(resolve('/'));
        }
      }
    }
    deleting = false;
  }

  async function sendMessage(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 500 || isLoading) return;
    if (userMessageCount >= config.public.maxMessages) return;
    if (!chatId) return;
    // Slash command: centralized dispatch via SLASH_COMMANDS
    if (handleSlashCommand(trimmed)) return;

    messageText = '';
    lastSentText = trimmed;
    isLoading = true;
    if (inputEl) inputEl.style.height = 'auto';

    const result = await sendChatMessage(trimmed, userId, chatId, messages);
    messages = result.messages;
    stickToBottom = true;

    if (result.locked && chatId) {
      chats = chats.map((c) => (c.id === chatId ? { ...c, locked: true } : c));
    }

    if (result.error) {
      isLoading = false;
    }
    // When accepted === true, isLoading stays true until SSE 'done' event
  }

  function dismissContactOverlay(): void {
    showContactForm = false;
    contactDismissed = true;
    if (browser && chatId) {
      try {
        const dismissed: string[] = JSON.parse(localStorage.getItem(CONTACT_DISMISSED_KEY) || '[]');
        if (!dismissed.includes(chatId)) {
          dismissed.push(chatId);
          localStorage.setItem(CONTACT_DISMISSED_KEY, JSON.stringify(dismissed));
        }
      } catch { /* ignore */ }
    }
  }

  /* ─── Slash command dispatch ─── */

  function _clearInput(): void {
    messageText = '';
    if (inputEl) inputEl.style.height = 'auto';
  }

  function _cmdContact(): boolean {
    contactDismissed = false;
    if (browser) {
      try {
        const dismissed: string[] = JSON.parse(localStorage.getItem(CONTACT_DISMISSED_KEY) || '[]');
        localStorage.setItem(CONTACT_DISMISSED_KEY, JSON.stringify(dismissed.filter((id: string) => id !== chatId)));
      } catch { /* ignore */ }
    }
    showContactForm = true;
    _clearInput();
    fetch('/api/leads/contact-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, chatId }),
    }).catch(() => {});
    return true;
  }

  function _cmdExportMd(): boolean {
    _clearInput();
    window.open(resolve(`/api/chat/${chatId}/export?format=md`), '_blank');
    return true;
  }

  function _cmdExportJson(): boolean {
    _clearInput();
    window.open(resolve(`/api/chat/${chatId}/export?format=json`), '_blank');
    return true;
  }

  function _cmdSummarize(): boolean {
    const hasUserMessages = messages.some((m) => m.role === 'user');
    if (!hasUserMessages) {
      _clearInput();
      const playfulReplies = [
        "You can't brew a potion from an empty cauldron! Toss in a question and let the magic begin.",
        "The void gazes back... and it's terribly boring. Say something before we both turn into spacetime dust.",
        'System online. Neural core ready. Input buffer... empty. Care to initiate first contact?',
        'Even a wizard needs words to weave with. What shall we conjure today?',
        "Beam me a query, Captain! This channel's running on empty — give me something to lock onto.",
        "The crystal ball's a bit foggy. Feed it a question and I'll divine an answer.",
        "This conversation is a black hole — all event horizon, no substance. Let's change that?",
        "42 is the answer to life, the universe, and everything... but what's your question?",
      ];
      const reply = playfulReplies[crypto.getRandomValues(new Uint32Array(1))[0] % playfulReplies.length];
      messages = [...messages, {
        id: randomUUID(),
        role: 'assistant' as const,
        text: reply,
        timestamp: Date.now(),
        createdAt: new Date().toISOString(),
      }];
      const fd = new FormData();
      fd.set('userId', userId);
      fd.set('role', 'assistant');
      fd.set('content', reply);
      fetch('?/store-message', { method: 'POST', body: fd }).catch(() => {});
      return true;
    }
    return false;
  }

  function _cmdShowPosts(): boolean {
    _clearInput();
    goto(resolve('/posts'));
    return true;
  }

  function _cmdShowExperience(): boolean {
    _clearInput();
    goto(resolve('/experience'));
    return true;
  }

  function _cmdAbout(): boolean {
    _clearInput();
    goto(resolve('/about'));
    return true;
  }

  function _cmdShowChats(): boolean {
    _clearInput();
    showMobile = true;
    return true;
  }

  function _cmdSurpriseMe(): boolean {
    _clearInput();
    const pick = SUGGESTED_QUESTIONS[Math.floor(Math.random() * SUGGESTED_QUESTIONS.length)];
    messageText = '';
    sendMessage(pick);
    return true;
  }

  function _cmdNew(): boolean {
    _clearInput();
    createChat();
    return true;
  }

  function _cmdHome(): boolean {
    _clearInput();
    goto(resolve('/'));
    return true;
  }

  function _cmdRestartTour(): boolean {
    _clearInput();
    fetch('/api/tours/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    }).then(() => {
      window.location.reload();
    }).catch(() => {});
    return true;
  }

  const SLASH_DISPATCH: Record<string, () => boolean> = {
    contact: _cmdContact,
    export_md: _cmdExportMd,
    export_json: _cmdExportJson,
    summarize: _cmdSummarize,
    show_posts: _cmdShowPosts,
    show_experience: _cmdShowExperience,
    about: _cmdAbout,
    show_chats: _cmdShowChats,
    surprise_me: _cmdSurpriseMe,
    new: _cmdNew,
    home: _cmdHome,
    restart_tour: _cmdRestartTour,
  };

  function handleSlashCommand(input: string): boolean {
    const matched = matchSlashCommand(input);
    if (!matched) return false;
    const handler = SLASH_DISPATCH[matched.name];
    if (handler) return handler();
    return false;
  }

  async function handleStop(): Promise<void> {
    if (!chatId) return;
    // Close client-side SSE connection
    disconnectSSE();
    // Tell server to abort the generation
    try {
      await fetch(`/chat/${chatId}?/abort`, { method: 'POST' });
    } catch {
      /* ignore network errors */
    }
    // Reset loading state
    isLoading = false;
    resetStreamingState();
  }

  function retry(): void {
    if (isLoading) return;
    const text = lastSentText || [...messages].reverse().find((m) => m.role === 'user')?.text || '';
    if (!text) return;
    messages = messages.slice(0, -2);
    sendMessage(text);
  }

  async function fetchReaction(messageId: string): Promise<{ type: 'up' | 'down' | 'heart'; reason: string } | null> {
    try {
      const res = await fetch(`/api/messages/${messageId}/reaction`, {
        headers: { 'x-user-id': userId },
      });
      if (res.ok) {
        const data = await res.json();
        return data.reaction;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function handleReport(messageId: string): void {
    messages = messages.map((m) => (m.id === messageId ? { ...m, deletedAt: new Date().toISOString() } : m));
  }

  /* ─── Effects ─── */

  // Load userId from localStorage and determine ownership
  $effect(() => {
    if (!browser || !chatId || !data?.chatOwnerId) return;
    let id: string;
    try {
      const stored = localStorage.getItem(USER_ID_KEY);
      if (stored) {
        id = stored;
      } else {
        id = randomUUID();
        localStorage.setItem(USER_ID_KEY, id);
      }
    } catch {
      id = randomUUID();
    }
    userId = id;
    isOwner = id === data.chatOwnerId;
  });

  // Fetch dismissed tours once userId is set
  $effect(() => {
    if (!browser || !userId) return;
    fetch(`/api/tours?userId=${encodeURIComponent(userId)}`)
      .then((r) => r.json())
      .then((data) => {
        dismissedFeatures = data.dismissed ?? [];
        // Find first undismissed tour
        activeTour = TOUR_DEFINITIONS.find((t) => !dismissedFeatures.includes(t.featureId));
      })
      .catch(() => {
        // Silently fail — tours are non-critical
      });
  });

  function handleDismissTour(): void {
    if (!activeTour || !userId) return;
    fetch('/api/tours/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, featureIds: [activeTour.featureId] }),
    }).catch(() => {});
    dismissedFeatures = [...dismissedFeatures, activeTour.featureId];
    // Find next undismissed tour
    activeTour = TOUR_DEFINITIONS.find((t) => !dismissedFeatures.includes(t.featureId));
  }

  let isOwner = $state<boolean | undefined>(undefined);

  // Track dismissed chats — reactive to chatId changes
  $effect(() => {
    if (!browser || !chatId) return;
    try {
      const dismissed = JSON.parse(localStorage.getItem(CONTACT_DISMISSED_KEY) || '[]');
      if (dismissed.includes(chatId)) contactDismissed = true;
    } catch {
      /* ignore */
    }
  });

  // Initialize messages + load chats when userId/chatId set
  // Separate from queryText so replaceState doesn't trigger re-run
  $effect(() => {
    if (!browser || !userId || !chatId) return;
    if (chatsLoaded) return;
    if (chats.length > 0) {
      chatsLoaded = true;
      return;
    }
    loadChats();
  });

  // Sync messages from server data or fallback to client fetch
  // Tracks chatId to clear stale messages on chat transitions
  let previousChatId = $state('');
  $effect(() => {
    if (!browser || !chatId) return;
    if (chatId !== previousChatId) {
      const isFirstRun = previousChatId === '';
      previousChatId = chatId;
      // Clear stale messages on chat transitions (not on SSR hydration)
      if (!isFirstRun) messages = [];
      loadMessages();
      return; // prevent re-populating from potentially stale data
    }
    // Same-chat path: data is for current chat, use it
    if (data?.messages?.length && !queryText) {
      messages = data.messages as ChatMessage[];
    } else if (!queryText) {
      loadMessages();
    }
  });

  // Auto-send from page state or URL param (pending message from home page)
  let autoSent = $state(false);
  $effect(() => {
    if (!browser || !userId || !chatId || isLoading || autoSent) return;
    const pending = (page.state as { q?: string })?.q || page.url.searchParams.get('q');
    if (!pending) return;
    autoSent = true;
    sendMessage(pending);
    // Clean up URL param to prevent re-sending on refresh
    const url = new URL(window.location.href);
    if (url.searchParams.has('q')) {
      url.searchParams.delete('q');
      history.replaceState(null, '', url.toString());
    }
  });

  // Global keyboard shortcuts
  $effect(() => {
    function onKeydown(e: KeyboardEvent): void {
      const el = e.target as HTMLElement;
      if (el?.isContentEditable || el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA') return;
      if (e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        focusInput();
      }
    }
    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
  });

  // Auto-scroll: scroll sentinel into view when messages change and stickToBottom
  // RAF-coalesced: collapses N token-triggered scrolls into 1 per frame (max 60fps)
  // Hash guard: when URL hash points to a message, skip auto-scroll — hash scroll effect handles positioning
  $effect(() => {
    if (!stickToBottom || !bottomSentinelEl) return;
    if (window.location.hash.startsWith('#msg-')) return;
    void messages;
    const el = bottomSentinelEl;
    scrollRAF = requestAnimationFrame(() => {
      el.scrollIntoView({ block: 'end' });
    });
    return () => cancelAnimationFrame(scrollRAF);
  });

  // Tick `now` for live tool call duration
  $effect(() => {
    if (activeToolCount > 0) {
      const id = setInterval(() => {
        now = Date.now();
      }, 250);
      return () => clearInterval(id);
    }
  });

  // IntersectionObserver: detect if user scrolled away from bottom
  $effect(() => {
    if (!browser || !bottomSentinelEl || !messageListEl) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        stickToBottom = entry.isIntersecting;
      },
      { root: messageListEl, rootMargin: '0px 0px 100px 0px', threshold: 0 },
    );
    observer.observe(bottomSentinelEl);
    return () => observer.disconnect();
  });

  // Keyboard open auto-scroll: keep last message visible above keyboard
  $effect(() => {
    if (!browser) return;
    const vv = window.visualViewport;
    if (!vv) return;

    let prevHeight = vv.height;

    const onResize = () => {
      const diff = prevHeight - vv.height;
      // Keyboard opened: viewport lost >100px → ensure scroll-to-bottom
      if (diff > 100) {
        stickToBottom = true;
        requestAnimationFrame(() => {
          bottomSentinelEl?.scrollIntoView({ block: 'end' });
        });
      }
      prevHeight = vv.height;
    };

    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  });

  // Scroll to message from URL hash on load and hash changes
  $effect(() => {
    if (!browser || !chatId) return;

    const scrollToHash = () => {
      const hash = window.location.hash;
      if (!hash.startsWith('#msg-')) return;
      const el = document.getElementById(hash.slice(1));
      if (el) {
        el.scrollIntoView({ block: 'center' });
      }
    };

    // Scroll on mount
    scrollToHash();

    // Scroll on hash changes
    window.addEventListener('hashchange', scrollToHash);
    return () => window.removeEventListener('hashchange', scrollToHash);
  });

  // Close sidebar on Escape key
  $effect(() => {
    if (!sidebarVisible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSidebar();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  });

  // Connect to SSE event source for real-time generation updates
  $effect(() => {
    if (!browser || !chatId) return;

    const cleanup = connectSSE(chatId, {
      onToken(token: string) {
        const last = messages[messages.length - 1];
        if (last?.role !== 'assistant') {
          messages = [
            ...messages,
            {
              id: randomUUID(),
              role: 'assistant' as const,
              text: '',
              timestamp: Date.now(),
              createdAt: '',
            },
          ];
        }
        const idx = messages.length - 1;
        messages[idx] = { ...messages[idx], text: messages[idx].text + token };
      },

      onDone(data) {
        const { messageId, answer, queryType, sources, usage, completedToolCalls } = data;

        // Skip replayed done events (already loaded from DB on page refresh)
        const existingIdx = messages.findIndex((m) => m.id === messageId);
        if (existingIdx !== -1) {
          messages[existingIdx] = { ...messages[existingIdx], error: undefined };
          return;
        }

        const last = messages[messages.length - 1];
        if (last?.role !== 'assistant') {
          // Reconnect case: generation completed between page load and EventSource
          messages = [
            ...messages,
            {
              id: messageId || randomUUID(),
              role: 'assistant' as const,
              queryType: queryType || '',
              text: answer || '',
              timestamp: Date.now(),
              createdAt: '',
              sources: sources as Source[],
              toolCalls: completedToolCalls,
            },
          ];
        } else {
          const idx = messages.length - 1;
          const oldPlaceholderId = messages[idx].id;
          messages[idx] = {
            ...messages[idx],
            id: messageId || messages[idx].id,
            text: answer || messages[idx].text,
            sources: (sources as Source[]) || messages[idx].sources,
            tokensIn: usage?.tokensIn || 0,
            tokensOut: usage?.tokensOut || 0,
            durationMs: usage?.durationMs || 0,
            toolCalls: completedToolCalls,
            error: undefined,
          };

          // Update URL hash if it still points to old placeholder ID from streaming
          if (messageId && window.location.hash === `#msg-${oldPlaceholderId}`) {
            history.replaceState(null, '', `#msg-${messageId}`);
          }

          // Migrate reaction if message ID changed from placeholder to real
          const reaction = messages[idx].reaction;
          if (messageId && oldPlaceholderId !== messageId && reaction) {
            (async () => {
              try {
                const postFd = new FormData();
                postFd.set('messageId', messageId);
                postFd.set('userId', userId);
                postFd.set('mode', 'set');
                postFd.set('reactionType', reaction.type);
                postFd.set('reason', reaction.reason || '');
                const postRes = await fetch(`/chat/${chatId}?/reaction`, { method: 'POST', body: postFd });
                if (postRes.ok) {
                  const delFd = new FormData();
                  delFd.set('messageId', oldPlaceholderId);
                  delFd.set('userId', userId);
                  delFd.set('mode', 'remove');
                  await fetch(`/chat/${chatId}?/reaction`, { method: 'POST', body: delFd }).catch(() => {});
                }
              } catch {
                /* ignore */
              }
            })();
          }

          // Update sidebar reference if it points to the old placeholder ID
          if (messageId && sidebarMessageId === oldPlaceholderId) {
            sidebarMessageId = messageId;
          }
        }

        if (isLoading) {
          isLoading = false;
          toast.success('Response complete');
          if (document.hidden) playPluckSound();
        }

        resetStreamingState();
        loadChats();
      },

      onError(data) {
        const { messageId, message, irrecoverable, attemptsLeft: attempts } = data;

        // Don't set error on messages already loaded from DB — they have correct state
        if (typeof messageId === 'string' && messages.some((m) => m.id === messageId)) return;

        const last = messages[messages.length - 1];
        if (last?.role !== 'assistant') {
          messages = [
            ...messages,
            {
              id: randomUUID(),
              role: 'assistant' as const,
              text: '',
              timestamp: Date.now(),
              createdAt: '',
              error: message,
              irrecoverable,
            },
          ];
        } else {
          const idx = messages.length - 1;
          messages[idx] = { ...messages[idx], error: message, irrecoverable };
        }
        isLoading = false;

        if (typeof attempts === 'number' && attempts > 0) {
          toast.warning(`Off-topic question — ${attempts} attempt${attempts > 1 ? 's' : ''} left before chat locks.`);
        }
        attemptsLeft = attempts ?? 0;

        if (irrecoverable && chatId) {
          attemptsLeft = 0;
          chats = chats.map((c) => (c.id === chatId ? { ...c, locked: true } : c));
        }
      },

      onContactIntent() {
        if (!contactDismissed) {
          showContactForm = true;
        }
      },

      onTimeout() {
        if (isLoading) {
          const last = messages[messages.length - 1];
          if (last?.role !== 'assistant') {
            messages = [
              ...messages,
              {
                id: randomUUID(),
                role: 'assistant' as const,
                text: '',
                timestamp: Date.now(),
                createdAt: '',
                error: 'Request timed out. The AI model may be temporarily unavailable. Please try again.',
              },
            ];
          } else {
            const idx = messages.length - 1;
            messages[idx] = { ...messages[idx], error: 'Request timed out. Please try again.' };
          }
          isLoading = false;
        }
      },
    });

    return cleanup;
  });

</script>

<svelte:head>
  <title>{currentChatTitle || 'Chat'} — woss</title>
</svelte:head>

<div class="flex flex-1 min-h-0">
  <ChatSidebar
    {chats}
    currentChatId={chatId}
    {canCreateChat}
    {showDeleteConfirm}
    bind:showMobile
    oncreateChat={createChat}
    onconfirmDeleteChat={confirmDeleteChat}
    ondeleteChat={deleteChat}
    oncancelDelete={() => (showDeleteConfirm = null)}
    oncommand={(t) => sendMessage(t)}
  />
  <!-- ─── Main Chat Area ─── -->
  <div class="flex-1 flex flex-col min-w-0 overflow-hidden lg:pt-0">
    {#if !hasMessages && !isLoading}
      <!-- Empty state: vertically centered -->
      <div class="flex-1 flex flex-col items-center justify-center gap-8 px-8 max-md:px-4">
        <p class="text-on-surface-variant text-lg max-md:text-base">No messages yet</p>
        <p class="text-on-surface-variant text-sm">Type a message below or pick a question.</p>
      </div>
    {:else}
      <!-- Messages area -->
      <div class="flex-1 overflow-y-auto overflow-x-hidden overscroll-behavior-contain min-h-0" bind:this={messageListEl}>
        <div class="mx-auto w-full max-w-180 py-2">
          <div class="flex flex-col gap-2">
            {#each messages as message, i (message.id)}
              <MsgCard
                {message}
                isLoading={i === messages.length - 1 && isLoading}
                isLast={i === messages.length - 1}
                streamingToolValues={i === messages.length - 1 ? streamingToolValues : []}
                {now}
                {userId}
                chatId={chatId ?? undefined}
                onretry={retry}
                onreport={handleReport}
                onToggleSidebar={(tab: 'sources' | 'tools') => openSidebar(message.id, tab)}
              />
            {/each}
          </div>
          {#if hasMessages}
            <div bind:this={bottomSentinelEl} aria-hidden="true" class="h-px"></div>
          {/if}
        </div>
      </div>
    {/if}

    {#if showContactForm}
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 max-md:p-3"
        onclick={dismissContactOverlay}
        onkeydown={(e) => { if (e.key === 'Escape') dismissContactOverlay(); }}
        role="dialog"
        aria-modal="true"
        aria-label="Contact form"
        tabindex="-1"
      >
        <div
          class="w-full max-w-lg rounded-2xl bg-surface border border-[rgba(255,255,255,0.08)] shadow-2xl overflow-hidden"
          onclick={(e) => e.stopPropagation()}
          onkeydown={(e) => e.stopPropagation()}
          role="none"
        >
          <div class="flex justify-end p-3 pb-0">
            <button
              type="button"
              aria-label="Close"
              onclick={dismissContactOverlay}
              class="flex items-center justify-center size-8 rounded-full text-outline hover:text-on-surface-variant hover:bg-white/5 transition-colors cursor-pointer"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <ContactForm bind:showContactForm {userId} chatId={chatId ?? undefined} bind:contactDismissed noHeader overlay />
        </div>
      </div>
    {/if}

    <!-- Scroll to bottom -->
    {#if !stickToBottom && hasMessages}
      <div class="flex justify-center py-1">
        <Button
          variant="outline"
          square
          size="sm"
          onclick={() => (stickToBottom = true)}
          class="rounded-full active:scale-95"
          aria-label="Scroll to bottom"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg
          >
        </Button>
      </div>
    {/if}

    <!-- Floating Chat Input -->
    {#if isOwner !== undefined}
      {#if maxMessagesReached && !isLoading}
        <div class="text-center p-4 border-t border-[rgba(255,255,255,0.08)]">
          <p class="text-sm text-on-surface-variant">
            This chat has reached the maximum of {config.public.maxMessages} messages. <Button
              variant="link"
              size="sm"
              class="inline underline"
              onclick={createChat}>Start a new chat</Button
            >
          </p>
        </div>
      {:else if isOwner}
        <div class="sticky bottom-0 bg-surface pt-2 pb-4">
          <div class="mx-auto w-full max-w-[720px] px-6 max-md:px-1">
            <ChatInput
              bind:messageText
              {isLoading}
              {currentChat}
              {attemptsLeft}
              messagesCount={userMessageCount}
              maxMessages={config.public.maxMessages}
              {activeToolCount}
              {completedToolCount}
              currentStatus={sseState.currentStatus}
              bind:inputEl
              onsend={(text: string) => sendMessage(text)}
              onstop={handleStop}
              oncreateChat={createChat}
            />
          </div>
        </div>
      {:else}
        <!-- Read-only banner for non-owners -->
        <div class="border-t border-[rgba(255,255,255,0.08)] px-4 py-6 text-center">
          <p class="text-sm text-on-surface-variant">This chat is shared in read-only mode.</p>
        </div>
      {/if}
    {/if}
  </div>

  <RightSidebar {sidebarVisible} {sidebarMessage} bind:sidebarTab onclose={closeSidebar} />
</div>

{#if activeTour}
  <FeatureTour
    targetSelector={activeTour.targetSelector}
    title={activeTour.title}
    content={activeTour.content}
    ondismiss={handleDismissTour}
  />
{/if}
