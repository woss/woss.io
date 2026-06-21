<script lang="ts">
  import type { Chat } from '$lib/chat/types';
  import { useSlashMenu } from '$lib/chat/use-slash-menu.svelte';
  import SlashMenu from './SlashMenu.svelte';
  import { config } from '$lib/config';
  import { enhance } from '$app/forms';
  import { Button, Textarea, Banner } from 'sv5ui';

  const MAX_CHARS = 500;

  const STATUS_LABELS: Record<string, string> = {
    checking_relevance: 'Checking relevance',
    embedding: 'Embedding',
    checking_cache: 'Checking cache',
    searching: 'Searching',
    generating: 'Generating',
  };

  let {
    messageText = $bindable(''),
    isLoading = $bindable(false),


    currentChat = null as Chat | null,
    attemptsLeft = 0,
    messagesCount = 0,
    maxMessages = config.public.maxMessages,
    activeToolCount = 0,
    completedToolCount = 0,
    currentStatus = '',
    inputEl = $bindable<HTMLElement | null>(null),
    onsend = () => {},
    oncreateChat = () => {},
    onstop = () => {},

    variant = 'chat',
  }: {
    messageText?: string;
    isLoading?: boolean;
    currentChat?: Chat | null;
    attemptsLeft?: number;
    messagesCount?: number;
    maxMessages?: number;
    activeToolCount?: number;
    completedToolCount?: number;
    currentStatus?: string;
    inputEl?: HTMLElement | null;
    onsend?: (text: string) => void;
    oncreateChat?: () => void;
    onstop?: () => void;
    variant?: string;
  } = $props();

  let formEl = $state<HTMLFormElement | undefined>(undefined);
  let charCount = $derived(messageText.length);
  let isOverLimit = $derived(charCount > MAX_CHARS);
  let hasText = $derived(messageText.trim().length > 0);

  const slash = useSlashMenu(
    () => messageText,
    (cmd) => onsend(cmd),
  );

  function handleSubmit({
    cancel,
  }: {
    action: URL;
    cancel: () => void;
    submitter: HTMLElement | null;
  }) {
    cancel();
    onsend(messageText);
  }

  function handleTextareaInput(): void {
    slash.handleInput();
  }

  function handleContentEditableInput(e: Event): void {
    const el = e.currentTarget as HTMLDivElement;
    messageText = el.innerText;
    if (messageText.trim() === '') {
      el.innerHTML = '';
      messageText = '';
    }
    slash.handleInput();
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (slash.handleKeydown(e)) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (variant === 'home') {
        onsend(messageText);
      } else {
        formEl?.requestSubmit();
      }
    }
    if (e.key === 'Escape') {
      messageText = '';
    }
  }

  function handleSend(): void {
    if (!hasText || isOverLimit || isLoading) return;
    if (variant === 'home') {
      onsend(messageText);
    } else {
      formEl?.requestSubmit();
    }
  }

  function handleStop(): void {
    onstop();
  }

  $effect(() => {
    if (
      variant === 'chat' &&
      inputEl &&
      'innerText' in inputEl &&
      (inputEl as HTMLDivElement).innerText !== messageText
    ) {
      (inputEl as HTMLDivElement).innerText = messageText;
    }
  });
</script>

{#if isLoading}
  <div class="py-1.5">
    <div class="flex items-center gap-2 text-xs font-mono min-h-4">
      {#if variant === 'chat' && activeToolCount > 0}
        <span class="text-yellow-400/90">Running {activeToolCount} tool{activeToolCount !== 1 ? 's' : ''}</span>
        {#if completedToolCount > 0}
          <span class="text-outline">· {completedToolCount} completed</span>
        {/if}
      {:else}
        <span class="text-on-surface-variant">{STATUS_LABELS[currentStatus] || 'Thinking'}</span>
        <span class="inline-flex gap-0.5">
          <span class="size-1 rounded-full bg-on-surface-variant animate-pulse-dot" style="animation-delay:0ms"></span>
          <span class="size-1 rounded-full bg-on-surface-variant animate-pulse-dot" style="animation-delay:200ms"
          ></span>
          <span class="size-1 rounded-full bg-on-surface-variant animate-pulse-dot" style="animation-delay:400ms"
          ></span>
        </span>
      {/if}
    </div>
  </div>
{/if}

{#snippet toolbar()}
  <div class="flex items-center justify-between px-3 pb-3 max-md:justify-end">
    <div>
      <span class="font-mono text-xs text-on-surface-variant max-md:hidden"
        >{messagesCount}/{maxMessages} messages</span
      >
    </div>
    <div class="flex-1 text-center px-2 max-md:hidden">
      <p class="text-xs text-on-surface-variant">AI can make mistakes. Verify important information.</p>
    </div>
    <span class="font-mono text-xs text-on-surface-variant" class:text-secondary={isOverLimit}
      >{charCount}/{MAX_CHARS}</span
    >
  </div>
{/snippet}

{#if variant === 'chat'}
  {#if currentChat?.locked}
    <Banner color="secondary" title="This chat has been locked because the question was off-topic.">
      <Button variant="link" size="sm" onclick={() => oncreateChat()}>Start a new chat</Button>
    </Banner>
  {:else}
    {#if attemptsLeft > 0}
      <Banner color="warning" title="{attemptsLeft} off-topic attempt{attemptsLeft > 1 ? 's' : ''} remaining before chat locks" />
    {/if}
    <form method="POST" action="?/ask" use:enhance={handleSubmit} bind:this={formEl}>
      <div
        class="relative rounded-xl border border-[rgba(255,255,255,0.08)] bg-surface-container-high transition-all duration-200"
      >
        <SlashMenu
          show={slash.showSlashMenu}
          commands={slash.slashFiltered}
          selectedIndex={slash.slashSelectedIndex}
          onselect={slash.selectSlashCommand}
          onmouseenter={(i: number) => (slash.slashSelectedIndex = i)}
        />
        <!-- Input row -->
<div class="flex items-center gap-2 px-3 pt-3 max-md:pt-3 max-md:px-1">
          <button
            type="button"
            onclick={slash.toggle}
          aria-label="Commands"
          id="slash-commands"
          class="flex items-center justify-center size-8 shrink-0 rounded-md text-sm font-mono font-semibold text-on-surface-variant hover:text-on-surface hover:bg-[rgba(255,255,255,0.06)] transition-all duration-100"
        >/</button>
        <div class="relative flex-1 min-w-0">
          <div
              contenteditable="true"
              role="textbox"
              aria-multiline="true"
              tabindex="0"
              class="flex-1 font-body text-base/normal text-on-surface bg-transparent py-3 outline-none min-h-[44px] max-h-[120px] overflow-y-auto [&:empty:before]:content-[attr(data-placeholder)] [&:empty:before]:text-on-surface-variant [&:empty:before]:pointer-events-none"
              data-placeholder="Ask Haistlin about my work."
              bind:this={inputEl}
              oninput={handleContentEditableInput}
              onkeydown={handleKeydown}
            ></div>
          </div>
          <!-- Submit / Stop button -->
          {#if isLoading}
            <Button icon="lucide:square" variant="soft" color="secondary" square size="md" onclick={handleStop} aria-label="Stop" />
          {:else}
            <Button icon="lucide:arrow-up" variant="solid" color="primary" square size="md" disabled={!hasText || isOverLimit} onclick={handleSend} aria-label="Send message" />
          {/if}
        </div>
        {@render toolbar()}
      </div>
    </form>
  {/if}
{:else}
  <div
    class="relative rounded-xl border border-[rgba(255,255,255,0.08)] bg-surface-container-high transition-all duration-200"
  >
    <SlashMenu
      show={slash.showSlashMenu}
      commands={slash.slashFiltered}
      selectedIndex={slash.slashSelectedIndex}
      onselect={slash.selectSlashCommand}
      onmouseenter={(i: number) => (slash.slashSelectedIndex = i)}
    />
    <!-- Input row -->
    <div class="flex items-center gap-2 px-3 pt-3 max-md:pt-3 max-md:px-2">
      <button
        type="button"
        onclick={slash.toggle}
        aria-label="Commands"
        id="slash-commands"
        class="flex items-center justify-center size-8 shrink-0 rounded-md text-sm font-mono font-semibold text-on-surface-variant hover:text-on-surface hover:bg-[rgba(255,255,255,0.06)] transition-all duration-100"
      >/</button>
      <div class="relative flex-1 min-w-0">
        {#if messageText.startsWith('/')}
          <span class="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-primary pointer-events-none z-10"
            >/</span
          >
        {/if}
        <Textarea
          variant="outline"
          autoresize
          bind:value={messageText}
          bind:ref={inputEl as unknown as HTMLTextAreaElement | null}
          placeholder="Ask Haistlin about my work."
          maxlength={MAX_CHARS}
          disabled={isLoading}
          oninput={handleTextareaInput}
          onkeydown={handleKeydown}
        ></Textarea>
      </div>
      <!-- Submit / Stop button -->
      {#if isLoading}
        <Button icon="lucide:square" variant="soft" color="secondary" square size="md" onclick={handleStop} aria-label="Stop" />
      {:else}
        <Button icon="lucide:arrow-up" variant="solid" color="primary" square size="md" disabled={!hasText || isOverLimit} onclick={handleSend} aria-label="Send message" />
      {/if}
    </div>
    {@render toolbar()}
  </div>
{/if}
