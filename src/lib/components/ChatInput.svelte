<script lang="ts">
  import { useSlashMenu } from '$lib/chat/use-slash-menu.svelte';
  import SlashMenu from './SlashMenu.svelte';

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
    activeToolCount = 0,
    completedToolCount = 0,
    currentStatus = '',
    inputEl = $bindable<HTMLElement | null>(null),
    locked = false,
    onsend = () => {},
    onstop = () => {},
  }: {
    messageText?: string;
    isLoading?: boolean;
    activeToolCount?: number;
    completedToolCount?: number;
    currentStatus?: string;
    inputEl?: HTMLElement | null;
    locked?: boolean;
    onsend?: (text: string) => void;
    onstop?: () => void;
  } = $props();

  let isFocused = $state(false);
  let charCount = $derived(messageText.length);
  let isOverLimit = $derived(charCount > MAX_CHARS);
  let hasText = $derived(messageText.trim().length > 0);

  const slash = useSlashMenu(
    () => messageText,
    (cmd) => onsend(cmd),
  );

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
    if (locked) return;
    if (slash.handleKeydown(e)) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onsend(messageText);
    }
    if (e.key === 'Escape') {
      messageText = '';
    }
  }

  function handleFocusIn(): void {
    isFocused = true;
  }

  function handleFocusOut(e: FocusEvent): void {
    const container = (e.currentTarget as HTMLElement).closest('[role="group"]');
    const related = e.relatedTarget as HTMLElement | null;
    if (related && container?.contains(related)) return;
    isFocused = false;
  }

  function handleSend(): void {
    if (!hasText || isOverLimit || isLoading) return;
    onsend(messageText);
  }

  function handleStop(): void {
    onstop();
  }

  $effect(() => {
    if (
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
      {#if activeToolCount > 0}
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

<div
  class="bits-prompt-input"
  class:focused={isFocused}
  class:locked
  role="group"
  aria-label="Chat input"
  onfocusin={handleFocusIn}
  onfocusout={handleFocusOut}
>
  <!-- Thinking sweep bar -->
  {#if isLoading}
    <div class="thinking-bar"></div>
  {/if}

  <!-- Northern lights glow layers -->
  <div class="northern-lights">
    <div class="northern-lights__edge-top"></div>
  </div>

  {#if !locked}
    <SlashMenu
      show={slash.showSlashMenu}
      commands={slash.slashFiltered}
      selectedIndex={slash.slashSelectedIndex}
      onselect={slash.selectSlashCommand}
      onmouseenter={(i: number) => (slash.slashSelectedIndex = i)}
    />
  {/if}

  <!-- Input area -->
  <div class="input-area">
    <div
      contenteditable={!locked}
      role="textbox"
      aria-multiline="true"
      tabindex={locked ? -1 : 0}
      class="input-field"
      data-placeholder={locked ? '' : 'Ask Haistlin about my work.'}
      bind:this={inputEl}
      oninput={handleContentEditableInput}
      onkeydown={handleKeydown}
    ></div>
  </div>

  {#if locked}
    <div class="locked-bar">
      <span class="locked-label">Chat locked</span>
    </div>
  {:else}
    <!-- Actions bar -->
    <div class="actions-bar">
      <div class="actions-start">
        <button
          type="button"
          onclick={slash.toggle}
          aria-label="Commands"
          id="slash-commands"
          class="slash-btn"
        >/</button>
        <span class="disclaimer">AI can make mistakes. Verify important information.</span>
      </div>
      <div class="actions-end">
        <span class="char-count" class:text-secondary={isOverLimit}>{charCount}/{MAX_CHARS}</span>
        {#if isLoading}
          <button
            type="button"
            onclick={handleStop}
            aria-label="Stop"
            class="submit-btn stop"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor"/>
            </svg>
          </button>
        {:else}
          <button
            type="button"
            onclick={handleSend}
            aria-label="Send message"
            disabled={!hasText || isOverLimit}
            class="submit-btn"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 12V2M7 2L3 6M7 2L11 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .bits-prompt-input {
    --_glow-color: transparent;
    --_edge-color: rgba(0, 218, 140, 0.4);
    --_edge-glow: rgba(0, 218, 140, 0.2);
    --_submit-bg: #00da8c;
    --_submit-hover: #00bf7d;
    --_submit-active: #00a36c;

    cursor: text;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    position: relative;
    background: var(--surface-container-high, #1e1e24);
    border: 1px solid rgba(255, 255, 255, 0.06);
    transition: border-color 0.2s, box-shadow 0.3s, background 0.3s;
  }

  .bits-prompt-input:hover:not(.focused) {
    border-color: rgba(255, 255, 255, 0.1);
  }

  .bits-prompt-input.focused {
    --_glow-color: rgba(0, 218, 140, 0.15);
    border-color: rgba(0, 218, 140, 0.4);
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.06),
      0 0 24px -4px var(--_glow-color),
      0 8px 24px -8px var(--_glow-color);
    background: var(--surface-container-high, #1e1e24);
  }

  .bits-prompt-input.focused .northern-lights {
    opacity: 1;
  }

  .bits-prompt-input.focused .northern-lights__edge-top {
    opacity: 0.5;
  }

  /* Northern lights overlay */
  .northern-lights {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.3s;
    overflow: hidden;
    z-index: 0;
  }

  .northern-lights__edge-top {
    position: absolute;
    top: 0;
    left: 15%;
    right: 15%;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent 0%,
      transparent 15%,
      var(--_edge-color) 40%,
      var(--_edge-color) 60%,
      transparent 85%,
      transparent 100%
    );
    filter: drop-shadow(0 0 3px var(--_edge-color)) drop-shadow(0 0 8px var(--_edge-glow));
    opacity: 0;
    transition: opacity 0.3s 0.15s;
  }

  /* Thinking sweep bar */
  .thinking-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 1px;
    border-radius: inherit;
    background: linear-gradient(
      90deg,
      transparent 0%,
      transparent 40%,
      var(--_submit-bg) 50%,
      transparent 60%,
      transparent 100%
    );
    filter: drop-shadow(0 0 3px var(--_submit-bg)) drop-shadow(0 0 10px var(--_submit-bg));
    animation: thinking-sweep 1.2s ease-in-out infinite alternate;
    pointer-events: none;
    z-index: 10;
  }

  @keyframes thinking-sweep {
    0% { transform: translateX(-40%); }
    100% { transform: translateX(40%); }
  }

  /* Input area */
  .input-area {
    position: relative;
    z-index: 1;
    padding: 8px 12px 0;
  }

  .input-field {
    min-height: 36px;
    max-height: 120px;
    overflow-y: auto;
    font-size: 14px;
    line-height: 1.5;
    color: var(--on-surface, #e3e2e6);
    outline: none;
    padding: 0;
    word-break: break-word;
  }

  .input-field:empty::before {
    content: attr(data-placeholder);
    color: var(--on-surface-variant, #938f99);
    pointer-events: none;
  }

  /* Actions bar */
  .actions-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px 8px;
    position: relative;
    z-index: 1;
  }

  .actions-start {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1;
  }

  .actions-end {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  /* Slash button */
  .slash-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: var(--on-surface-variant, #938f99);
    font-family: monospace;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    flex-shrink: 0;
  }

  .slash-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--on-surface, #e3e2e6);
  }

  /* Disclaimer */
  .disclaimer {
    font-size: 11px;
    color: var(--on-surface-variant, #938f99);
    opacity: 0.6;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Char count */
  .char-count {
    font-family: monospace;
    font-size: 11px;
    color: var(--on-surface-variant, #938f99);
    opacity: 0.6;
  }

  .char-count.text-secondary {
    color: #ef4444;
    opacity: 1;
  }

  /* Submit button — Bits style: 28px circle */
  .submit-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    border: none;
    background: var(--_submit-bg);
    color: #fff;
    cursor: pointer;
    transition: background 0.1s, transform 0.1s, border-radius 0.1s;
    position: relative;
    flex-shrink: 0;
  }

  .submit-btn::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    box-shadow: inset 0 0.5px 1.25px rgba(255, 255, 255, 0.35);
    pointer-events: none;
    mix-blend-mode: plus-lighter;
  }

  .submit-btn:hover:not(:disabled) {
    background: var(--_submit-hover);
  }

  .submit-btn:active:not(:disabled) {
    transform: scale(0.9);
    background: var(--_submit-active);
  }

  .submit-btn:disabled {
    background: rgba(0, 218, 140, 0.15);
    color: rgba(255, 255, 255, 0.2);
    cursor: not-allowed;
  }

  .submit-btn.stop {
    background: #00c986;
  }

  .submit-btn.stop:hover {
    background: #00d690;
  }

  /* Locked state */
  .bits-prompt-input.locked {
    opacity: 0.5;
    pointer-events: none;
    cursor: default;
  }

  .locked-bar {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px 12px 8px;
    position: relative;
    z-index: 1;
  }

  .locked-label {
    font-size: 12px;
    color: var(--on-surface-variant, #938f99);
  }


</style>
