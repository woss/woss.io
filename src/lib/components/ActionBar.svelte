<script lang="ts">
 import { toast } from 'svelte-sonner';
 import { Tooltip, AvatarGroup, Button } from 'sv5ui';
 import { copyToClipboard } from '$lib/utils/clipboard';
 import { nameToColor, nameToInitial } from '$lib/utils/avatar';
 import type { ChatMessage } from '$lib/chat/types';

 let {
 message,
 userId = '',
 chatId = '',
  onOpenSidebar = () => {},
 }: {
 message: ChatMessage;
 userId?: string;
 chatId?: string;
 onOpenSidebar?: (tab: 'sources' | 'tools') => void;
 } = $props();

 let hasSources = $derived(!!(message.sources?.length));
 let sourceCount = $derived(message.sources?.length || 0);
 let hasTools = $derived(!!(message.toolCalls?.length));
 let toolCalls = $derived(message.toolCalls || []);

  function shareMessage(): void {
 const url = `${window.location.origin}${window.location.pathname}#msg-${message.id}`;
 if (copyToClipboard(url)) toast.success('Link copied');
 }

 function copyMessage(): void {
 if (copyToClipboard(message.text)) toast.success('Message copied');
 }

 /* ─── Reaction Functions ─── */

 async function setMessageReaction(
 messageId: string,
 type: 'up' | 'down' | 'heart',
 ): Promise<void> {
 try {
 const fd = new FormData();
 fd.set('messageId', messageId);
 fd.set('userId', userId);
 fd.set('mode', 'set');
 fd.set('reactionType', type);
 fd.set('reason', '');
 await fetch(`/chat/${chatId}?/reaction`, {
 method: 'POST',
 body: fd,
 });
 } catch {
 /* ignore */
 }
 }

 async function removeMessageReaction(messageId: string): Promise<void> {
 try {
 const fd = new FormData();
 fd.set('messageId', messageId);
 fd.set('userId', userId);
 fd.set('mode', 'remove');
 await fetch(`/chat/${chatId}?/reaction`, {
 method: 'POST',
 body: fd,
 });
 } catch {
 /* ignore */
 }
 }

 async function handleReaction(
 msg: ChatMessage,
 type: 'up' | 'down' | 'heart',
 ): Promise<void> {
 if (msg.reaction?.type === type) {
 msg.reaction = null;
 await removeMessageReaction(msg.id);
 toast.success('Reaction removed');
 return;
 }

 if (type === 'heart') {
 msg.reaction = { type: 'heart', reason: '' };
 await setMessageReaction(msg.id, 'heart');
 toast.success("Can't believe someone clicked on this ❤️❤️❤️ Yuh a di best!");
 return;
 }

 if (type === 'down') {
 msg.reaction = { type: 'down', reason: '' };
 } else {
 msg.reaction = { type: 'up', reason: '' };
 }
 await setMessageReaction(msg.id, type);
 toast.success('Thanks for the feedback!');
 }
</script>

<div class="flex items-center justify-between flex-1 text-xs text-outline h-8">
 <div class="flex items-center gap-1">
  <!-- Share -->
  <Tooltip text="Copy link" side="bottom">
    <Button variant="ghost" square size="sm" onclick={shareMessage} aria-label="Share link">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
        <polyline points="16 6 12 2 8 6" />
        <line x1="12" y1="2" x2="12" y2="15" />
      </svg>
    </Button>
  </Tooltip>

  <!-- Copy -->
  <Tooltip text="Copy" side="bottom">
    <Button variant="ghost" square size="sm" onclick={copyMessage} aria-label="Copy message">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    </Button>
  </Tooltip>

 <!-- Sources & Tools chip -->
 {#if hasSources || hasTools}
 <button
 class="bg-transparent border-0 cursor-pointer flex items-center gap-1.5 px-3 h-8 rounded-full text-outline hover:text-on-surface hover:bg-surface-container-high transition-colors active:scale-[0.97]"
 onclick={() => onOpenSidebar(hasSources ? 'sources' : 'tools')}
 aria-label="View sources and tools"
 >
 {#if hasSources}
 <AvatarGroup
 size="2xs"
 max={3}
  avatars={message.sources!.slice(0, 3).map((s) => ({
 text: nameToInitial(s.title || s.url || 'S', s.type),
 color: nameToColor(s.title || s.url || 'Source', s.type),
 alt: s.title || 'Source'
 }))}
 />
 {/if}
 {#if hasTools}
 <span class="text-xs shrink-0">⚙</span>
 {/if}
  <span class="text-xs font-mono whitespace-nowrap max-md:hidden">
 {#if hasSources && hasTools}
 {sourceCount} {sourceCount === 1 ? 'source' : 'sources'} · {toolCalls.length} {toolCalls.length === 1 ? 'tool' : 'tools'}
 {:else if hasSources}
 {sourceCount} {sourceCount === 1 ? 'source' : 'sources'}
 {:else if hasTools}
 {toolCalls.length} {toolCalls.length === 1 ? 'tool' : 'tools'}
 {/if}
 </span>
 </button>
 {/if}
 </div>

 {#if message.role !== 'user'}
 <div class="flex items-center gap-1">
  <Button
  variant="ghost" square size="sm"
  class={message.reaction?.type === 'up' ? 'text-[#00da8c]' : ''}
  onclick={() => handleReaction(message, 'up')}
  aria-label="Thumbs up"
  title="Helpful"
  >
  <svg
  width="14"
  height="14"
  viewBox="0 0 24 24"
  fill={message.reaction?.type === 'up' ? 'currentColor' : 'none'}
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  >
  <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
  </svg>
  </Button>
  <Button
  variant="ghost" square size="sm"
  class={message.reaction?.type === 'down' ? 'text-[#00da8c]' : ''}
  onclick={() => handleReaction(message, 'down')}
  aria-label="Thumbs down"
  title="Not helpful"
  >
  <svg
  width="14"
  height="14"
  viewBox="0 0 24 24"
  fill={message.reaction?.type === 'down' ? 'currentColor' : 'none'}
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  class="rotate-180"
  >
  <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
  </svg>
  </Button>
  <Button
  variant="ghost" square size="sm"
  class={message.reaction?.type === 'heart' ? 'text-[#00da8c]' : ''}
  onclick={() => handleReaction(message, 'heart')}
  aria-label="Heart"
  title="Love it"
  >
  <svg
  width="14"
  height="14"
  viewBox="0 0 24 24"
  fill={message.reaction?.type === 'heart' ? 'currentColor' : 'none'}
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  >
  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
  </Button>
 </div>
 {/if}
</div>
