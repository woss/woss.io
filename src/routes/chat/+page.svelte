<script lang="ts">
 import { browser } from '$app/environment';
 import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { matchSlashCommand } from '$lib/chat/slash-commands';
import ChatSidebar from '$lib/components/ChatSidebar.svelte';
import { Button, Icon } from 'sv5ui';
import { SUGGESTED_QUESTIONS } from '$lib/chat/suggested-questions';
import { createChat as createChatApi, deleteChat as deleteChatApi } from '$lib/chat/chat-crud';
 import type { Chat } from '$lib/chat/types';
 import { config } from '$lib/config';
 import { USER_ID_KEY } from '$lib/chat/constants';

 let userId = $state('');
 let chats = $state<Chat[]>([]);
 let chatsLoaded = $state(false);
 let showDeleteConfirm = $state<string | null>(null);
let deleting = $state(false);
let showMobile = $state(false);

// Load userId from localStorage
 $effect(() => {
 if (!browser) return;
 try {
 const stored = localStorage.getItem(USER_ID_KEY);
 if (stored) userId = stored;
 } catch { /* ignore */ }
 });

 // Load chats when userId is available
 $effect(() => {
 if (!browser || !userId || chatsLoaded) return;
 fetch(`/api/chat?userId=${encodeURIComponent(userId)}`)
 .then(r => r.json())
 .then(d => { chats = d.chats; chatsLoaded = true; })
 .catch(() => { chatsLoaded = true; });
 });

 let canCreateChat = $derived(chats.length < config.public.maxChats);

 async function createChat(): Promise<void> {
 if (!canCreateChat) return;
 const id = await createChatApi(userId);
 if (id) goto(resolve(`/chat/${id}`));
 }

 async function askQuestion(question: string): Promise<void> {
 if (!canCreateChat) return;
 const id = await createChatApi(userId);
 if (id) goto(resolve(`/chat/${id}?q=${encodeURIComponent(question)}`));
 }

 function confirmDeleteChat(chatId: string): void {
 showDeleteConfirm = chatId;
 }

 async function deleteChat(chatId: string): Promise<void> {
 if (deleting) return;
 deleting = true;
 showDeleteConfirm = null;
 const ok = await deleteChatApi(userId, chatId);
 if (ok) {
 chats = chats.filter((c) => c.id !== chatId);
 }
 deleting = false;
 }
</script>

<svelte:head>
 <title>Chats — woss</title>
</svelte:head>

<div class="flex flex-1 min-h-0">
  <!-- Mobile header bar (hamburger + title) -->
  <div class="md:hidden flex items-center justify-between px-4 py-3 border-b border-white/8 bg-surface shrink-0">
    <h1 class="font-heading text-sm font-semibold text-on-surface">Chats</h1>
    <Button
      variant="ghost" square size="sm"
      icon="lucide:menu"
      aria-label="Open chat list"
      onclick={() => (showMobile = true)}
    />
  </div>
  <ChatSidebar
 {chats}
 currentChatId={null}
 {canCreateChat}
 {showDeleteConfirm}
 bind:showMobile
 oncreateChat={createChat}
 onconfirmDeleteChat={confirmDeleteChat}
 ondeleteChat={deleteChat}
	oncancelDelete={() => (showDeleteConfirm = null)}
	oncommand={(t) => {
		const matched = matchSlashCommand(t);
		if (matched && ['show_posts', 'show_experience', 'about'].includes(matched.name)) {
			if (matched.name === 'show_posts') goto(resolve('/posts'));
			else if (matched.name === 'show_experience') goto(resolve('/experience'));
			else if (matched.name === 'about') goto(resolve('/about'));
			return;
		}
		if (!canCreateChat) return;
		createChatApi(userId).then(id => { if (id) goto(resolve(`/chat/${id}?q=${encodeURIComponent(t)}`)); });
	}}
	/>

 <!-- Welcome area when no chat is selected -->
{#if SUGGESTED_QUESTIONS.length === 0}
 <div class="flex-1 flex items-center justify-center bg-surface">
 <div class="text-center px-8">
 <h1 class="text-2xl font-heading font-semibold text-on-surface mb-2">Chats</h1>
 <p class="text-on-surface-variant text-sm max-w-md">
 Select a chat from the sidebar or create a new one to get started.
 </p>
 </div>
 </div>
{:else}
 <div class="flex-1 flex flex-col items-center justify-center bg-surface px-4 py-8">
 <h2 class="text-xl font-heading font-semibold text-on-surface mb-6">Why not start with these?</h2>
 <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-w-3xl w-full">
  {#each SUGGESTED_QUESTIONS as q (q)}
 <button
 onclick={() => askQuestion(q)}
 class="text-left flex items-start gap-3 p-4 rounded-xl bg-surface-container-high border border-[rgba(255,255,255,0.06)] hover:border-primary/30 hover:shadow-[0_0_20px_rgba(0,218,140,0.06)] hover:-translate-y-0.5 transition-all duration-150 cursor-pointer"
 >
 <Icon name="lucide:message-circle" size={18} class="shrink-0 mt-0.5 text-on-surface-variant" />
  <span class="text-sm/snug text-on-surface">{q}</span>
 </button>
 {/each}
 </div>
 </div>
{/if}
</div>
