<script lang="ts">
  import dayjs from 'dayjs';
  import relativeTime from 'dayjs/plugin/relativeTime.js';
  import utc from 'dayjs/plugin/utc.js';
  import 'highlight.js/styles/atom-one-dark.css';
  import { toast } from 'svelte-sonner';
  import type { ChatMessage } from '$lib/chat/types';
  import { page } from '$app/state';
  import { Button, Input } from 'sv5ui';
  import ActionBar from './ActionBar.svelte';
  import ToolCallList from './ToolCallList.svelte';

  dayjs.extend(relativeTime);
  dayjs.extend(utc);

  let {
    message,
    isLoading = false,
    isLast = false,
    streamingToolValues = [] as Array<{
      id: string;
      name: string;
      serverId: string;
      startedAt: number;
      finishedAt?: number;
    }>,
    now = Date.now(),
    userId = '',
    chatId = '',
    onretry = () => {},
    onreport = () => {},
    onToggleSidebar = () => {},
  }: {
    message: ChatMessage;
    isLoading?: boolean;
    isLast?: boolean;
    streamingToolValues?: Array<{ id: string; name: string; serverId: string; startedAt: number; finishedAt?: number }>;
    now?: number;
    userId?: string;
    chatId?: string;
    onretry?: () => void;
    onreport?: (id: string) => void;
    onToggleSidebar?: (tab: 'sources' | 'tools') => void;
  } = $props();

  let downReason = $state('');

  let cardHtml = $state('');

  $effect(() => {
    if (!message.text) {
      cardHtml = '';
      return;
    }
    const cid = chatId;
    const mid = message.id;
    const qp = page.data.queryParams;
    const txt = message.text;

    let cancelled = false;
    import('$lib/chat/markdown').then((mod) => {
      if (cancelled) return;
      const md = mod.createMarkdownRenderer({ chatId: cid, messageId: mid, queryParams: qp });
      cardHtml = mod.sanitizeHtml(mod.postprocessHtml(md.render(mod.preprocessMarkdown(txt))));
    });
    return () => {
      cancelled = true;
    };
  });

  async function submitDownReason(message: ChatMessage, reason: string): Promise<void> {
    try {
      const fd = new FormData();
      fd.set('messageId', message.id);
      fd.set('userId', userId);
      fd.set('reason', reason.trim());
      const res = await fetch(`/chat/${chatId}?/report`, {
        method: 'POST',
        body: fd,
      });
      if (res.ok) {
        onreport(message.id);
        toast.success('Thanks for the feedback');
      }
    } catch {
      /* ignore */
    }
  }

  const proseCls =
    'prose prose-invert max-w-none text-on-surface/90 leading-relaxed ' +
    '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 ' +
    '[&_pre]:bg-surface-container-high [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:border [&_pre]:border-[rgba(255,255,255,0.08)] [&_pre]:overflow-x-auto ' +
    '[&_code]:text-sm [&_code]:font-mono ' +
    '[&_blockquote]:border-l-4 [&_blockquote]:border-primary/30 [&_blockquote]:pl-4 [&_blockquote]:text-on-surface-variant [&_blockquote]:italic [&_blockquote]:my-2 ' +
    '[&_table]:w-full [&_table]:border-collapse [&_table]:border [&_table]:border-[rgba(255,255,255,0.08)] ' +
    '[&_th]:border [&_th]:border-[rgba(255,255,255,0.08)] [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-sm [&_th]:font-semibold ' +
    '[&_td]:border [&_td]:border-[rgba(255,255,255,0.08)] [&_td]:px-3 [&_td]:py-2 [&_td]:text-sm ' +
    '[&_hr]:border-t [&_hr]:border-[rgba(255,255,255,0.08)] [&_hr]:my-4 ' +
    '[&_a]:text-[#00da8c] [&_a:hover]:underline [&_a[target="_blank"]]:inline-flex [&_a[target="_blank"]]:items-center [&_a[target="_blank"]]:gap-1 [&_a[target="_blank"]]:after:content-["_↗"] [&_a[target="_blank"]]:after:text-xs [&_a[target="_blank"]]:after:opacity-60 ' +
    '[&_img]:max-w-full [&_img]:max-h-[50vh] [&_img]:h-auto [&_img]:rounded-lg [&_img]:my-2 [&_img]:shadow-lg ' +
    '[&_ul]:list-disc [&_ul]:pl-5 max-md:[&_ul]:pl-1 [&_ul]:space-y-0.5 [&_ul]:my-1 ' +
    '[&_ol]:list-decimal [&_ol]:pl-5 max-md:[&_ol]:pl-1 [&_ol]:space-y-0.5 [&_ol]:my-1 ' +
    '[&_li]:leading-normal ' +
    '[&_h1]:text-xl [&_h1]:font-heading [&_h1]:font-semibold [&_h1]:text-on-surface [&_h1]:mt-6 [&_h1]:mb-3 ' +
    '[&_h2]:text-lg [&_h2]:font-heading [&_h2]:font-semibold [&_h2]:text-on-surface [&_h2]:mt-5 [&_h2]:mb-2 ' +
    '[&_h3]:text-base [&_h3]:font-heading [&_h3]:font-semibold [&_h3]:text-on-surface [&_h3]:mt-4 [&_h3]:mb-2';
</script>

<div id="msg-{message.id}" class="group p-2">
  {#if message.deletedAt}
    <div class="w-full max-w-180 mx-auto px-6 max-md:px-1">
      <div class="flex items-center gap-2 text-outline">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><polyline points="3 6 5 6 21 6" /><path
            d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
          /></svg
        >
        <span class="font-body text-sm">Message deleted</span>
        <span class="font-mono text-xs">· {dayjs.utc(message.deletedAt).fromNow()}</span>
      </div>
    </div>
  {:else if message.error}
    <div class="w-full max-w-[720px] mx-auto px-6 max-md:px-1 animate-message-in">
      <div class="flex items-start gap-3">
        <div
          class="flex items-center justify-center size-8 rounded-full bg-secondary/20 text-secondary shrink-0 mt-0.5"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line
              x1="12"
              y1="16"
              x2="12.01"
              y2="16"
            />
          </svg>
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-body text-sm font-medium text-gray-200 mb-1">Unable to process request</p>
          <p class="font-body text-sm text-on-surface-variant">{message.error}</p>
        </div>
        {#if !message.irrecoverable}
          <Button
            variant="outline"
            color="primary"
            size="sm"
            onclick={() => onretry()}
            disabled={isLoading}
            class="rounded-full"
          >
            Try again
          </Button>
        {/if}
      </div>
    </div>
  {:else if message.role === 'user'}
    <div class="flex justify-end">
      <div class="w-full max-w-full px-6 max-md:px-1" class:animate-message-in={!isLoading}>
        <div class="group relative flex items-end justify-end">
          <div class="flex items-start gap-1 w-full justify-end">
            <!-- Hover icons (left of bubble, Perplexity-style) -->
            <div
              class="flex items-center gap-0.5 pt-3 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
            >
              <ActionBar {message} {userId} {chatId} onOpenSidebar={(tab) => onToggleSidebar(tab)} />
            </div>
            <!-- User message bubble -->
            <div class="max-w-[85%] md:max-w-[75%] rounded-2xl rounded-br-md bg-surface-container-low/30 px-4 py-3">
              <div class="text-sm/relaxed md:text-base font-body font-normal text-on-surface">
                {message.text}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  {:else}
    <!-- Assistant message -->
    <div class="flex justify-start">
      <div class="w-full max-w-[720px] px-6 max-md:px-1" class:animate-message-in={!isLoading}>
        <!-- Streaming dots -->
        {#if isLoading && isLast && !message.text}
          <div class="flex gap-1.5 py-4">
            <span class="size-2 rounded-full bg-[#00da8c] animate-pulse-dot" style="animation-delay: 0s"></span>
            <span class="size-2 rounded-full bg-[#00da8c] animate-pulse-dot" style="animation-delay: 0.15s"></span>
            <span class="size-2 rounded-full bg-[#00da8c] animate-pulse-dot" style="animation-delay: 0.3s"></span>
          </div>
        {/if}

        <!-- Markdown content -->
        {#if message.text}
          <div class={proseCls}>
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html cardHtml}
          </div>
        {:else if !isLoading}
          <p class="text-outline italic">No response</p>
        {/if}

        <!-- Streaming tool calls -->
        <ToolCallList tools={streamingToolValues} {now} />

        <!-- ActionBar -->
        {#if !(isLast && isLoading) && message.text && !message.deletedAt}
          <div class="mt-4 flex items-center gap-2 text-xs text-outline font-mono">
            <ActionBar {message} {userId} {chatId} onOpenSidebar={(tab) => onToggleSidebar(tab)} />
            <!-- {#if message.durationMs}
 <span class="shrink-0">·</span>
 <span class="shrink-0">{formatDuration(message.durationMs)}</span>
 {/if}
 <span class="shrink-0">{dayjs.utc(message.createdAt || message.timestamp).fromNow()}</span> -->
            {#if message.queryType}
              <span class="shrink-0">·</span>
              <span class="shrink-0 px-1.5 py-0.5 rounded-full bg-surface-container-high text-[10px]"
                >{message.queryType}</span
              >
            {/if}
          </div>
        {/if}

        <!-- Reason input (thumbs down) -->
        {#if message.reaction?.type === 'down'}
          <div class="mt-3">
            <div class="flex gap-2">
              <Input
                type="text"
                variant="outline"
                size="sm"
                placeholder="What was missing or incorrect?"
                bind:value={downReason}
                onkeydown={(e: KeyboardEvent) => {
                  if (e.key === 'Enter' && downReason.trim() !== '') {
                    submitDownReason(message, downReason);
                  }
                }}
              />
              <Button
                variant="solid"
                color="primary"
                disabled={downReason.trim() === ''}
                onclick={() => {
                  if (downReason.trim() !== '') {
                    submitDownReason(message, downReason);
                  }
                }}
              >
                Send feedback & remove
              </Button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
