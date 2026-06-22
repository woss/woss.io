<script lang="ts">
  import { Button } from 'sv5ui';
  import { nameToColor, nameToInitial } from '$lib/utils/avatar';
  import type { ChatMessage, ToolCallInfo } from '$lib/chat/types';

 let {
 sidebarVisible = false,
 sidebarMessage = null,
 sidebarTab = $bindable('sources'),
 onclose = () => {},
 }: {
 sidebarVisible: boolean;
 sidebarMessage: ChatMessage | null;
 sidebarTab?: 'sources' | 'tools';
 onclose?: () => void;
 } = $props();

 /** Safely extract hostname from a URL string. Returns empty string for invalid/empty URLs. */
 function getHostname(url: string | undefined | null): string {
 if (!url) return '';
 try {
 return new URL(url).hostname;
 } catch {
 return '';
 }
 }

 let toolGroups = $derived.by(() => {
 const calls = sidebarMessage?.toolCalls;
 if (!calls?.length) return [];
 const seen: Record<string, ToolCallInfo[]> = {};
 for (const tool of calls) {
 const list = seen[tool.serverId];
 if (list) {
 list.push(tool);
 } else {
 seen[tool.serverId] = [tool];
 }
 }
 const groups: { serverId: string; startIndex: number; tools: ToolCallInfo[] }[] = [];
 let startIndex = 0;
 for (const [serverId, tools] of Object.entries(seen)) {
 groups.push({ serverId, startIndex, tools });
 startIndex += tools.length;
 }
 return groups;
 });
</script>

{#snippet headerContent()}
 <div class="flex items-center justify-between p-4 border-b border-[rgba(255,255,255,0.08)] shrink-0">
 <h3 class="font-heading text-xs font-semibold text-on-surface-variant uppercase tracking-wider m-0">
 {sidebarTab === 'sources' ? 'Sources' : 'Tools'}
 </h3>
  <Button
  variant="ghost" square size="xs"
  onclick={onclose}
  aria-label="Close sidebar"
  >
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
  </Button>
 </div>
{/snippet}

{#snippet mainContent()}
 {#if sidebarMessage}
 <!-- Tab bar -->
 <div class="flex border-b border-[rgba(255,255,255,0.08)] shrink-0">
 <button
 onclick={() => sidebarTab = 'sources'}
 class="flex-1 py-2.5 text-xs font-medium border-b-2 transition-colors bg-transparent cursor-pointer"
 class:border-primary={sidebarTab === 'sources'}
 class:text-on-surface={sidebarTab === 'sources'}
 class:border-transparent={sidebarTab !== 'sources'}
 class:text-on-surface-variant={sidebarTab !== 'sources'}
 >
 Sources {#if sidebarMessage.sources?.length}({sidebarMessage.sources.length}){/if}
 </button>
 <button
 onclick={() => sidebarTab = 'tools'}
 class="flex-1 py-2.5 text-xs font-medium border-b-2 transition-colors bg-transparent cursor-pointer"
 class:border-primary={sidebarTab === 'tools'}
 class:text-on-surface={sidebarTab === 'tools'}
 class:border-transparent={sidebarTab !== 'tools'}
 class:text-on-surface-variant={sidebarTab !== 'tools'}
 >
 Tools {#if sidebarMessage.toolCalls?.length}({sidebarMessage.toolCalls.length}){/if}
 </button>
 </div>

 <!-- Content -->
 <div class="flex-1 overflow-y-auto">
 {#if sidebarTab === 'sources'}
 {#if sidebarMessage.sources && sidebarMessage.sources.length > 0}
 <div class="p-4 space-y-3">
 {#each sidebarMessage.sources as source (source.url)}
 <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
 <a href={source.url || '#'}
 target="_blank"
 rel="noopener noreferrer"
 class="flex items-start gap-3 p-3 rounded-lg bg-surface-container/50 hover:bg-surface-container transition-colors no-underline"
 >
 <div
 class="size-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5"
 style="background-color: {nameToColor(source.title || source.url || 'Source', source.type)};"
 >
 <span class="text-white">{nameToInitial(source.title || source.url || 'S', source.type)}</span>
 </div>
 <div class="min-w-0 flex-1">
 <p class="text-sm font-medium text-on-surface truncate">{source.title || 'Untitled'}</p>
 <p class="text-xs text-on-surface-variant truncate mt-0.5">{getHostname(source.url)}</p>
 {#if source.score !== undefined}
 <div class="mt-2 h-1 rounded-full bg-surface-container-high overflow-hidden">
 <div
 class="h-full rounded-full transition-all duration-500"
 style="width: {Math.round((1 - source.score) * 100)}%; background-color: {1 - source.score > 0.6 ? 'var(--color-primary)' : 1 - source.score > 0.45 ? 'var(--color-warning)' : 'var(--color-error)'};"
 ></div>
 </div>
  {/if}
  {#if source.chunkCount && source.chunkCount > 1}
    <span class="text-xs text-on-surface-variant">{source.chunkCount} chunks</span>
  {/if}
  </div>
  <svg class="size-4 text-on-surface-variant shrink-0 mt-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
 </a>
 {/each}
 </div>
 {:else}
 <div class="flex-1 flex items-center justify-center p-4">
 <p class="text-xs text-on-surface-variant text-center">No sources for this message</p>
 </div>
 {/if}
 {:else}
 {#if toolGroups.length > 0}
 <div class="p-4 space-y-4">
 {#each toolGroups as group, gi (gi)}
 <div>
 <h4 class="text-xs font-mono uppercase tracking-wider text-on-surface-variant mb-2 px-1">{group.serverId}</h4>
 <div class="space-y-2">
 {#each group.tools as tool, i (tool.id)}
 <div class="flex items-start gap-3 p-3 rounded-lg bg-surface-container/50 hover:bg-surface-container transition-colors">
 <div
 class="size-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5"
 style="background-color: {nameToColor(tool.name, tool.serverId)};"
 >
 <span class="text-white">{nameToInitial(tool.name, tool.serverId)}</span>
 </div>
 <div class="min-w-0 flex-1">
 <p class="text-sm font-medium text-on-surface truncate">#{group.startIndex + i + 1} {tool.name}</p>
 {#if tool.durationMs != null}
 <p class="text-xs text-on-surface-variant mt-1">Duration: {(tool.durationMs / 1000).toFixed(1)}s</p>
 {/if}
 </div>
 </div>
 {/each}
 </div>
 </div>
 {/each}
 </div>
 {:else}
 <div class="flex-1 flex items-center justify-center p-4">
 <p class="text-xs text-on-surface-variant text-center">No tool calls for this message</p>
 </div>
 {/if}
 {/if}
 </div>
 {:else}
 <div class="flex-1 flex items-center justify-center p-4">
 <p class="text-xs text-on-surface-variant text-center">Sources and tool calls<br />appear here</p>
 </div>
 {/if}
{/snippet}

<!-- Desktop panel -->
<div
 class="hidden xl:flex flex-col w-[360px] shrink-0 border-l border-[rgba(255,255,255,0.08)] bg-surface transition-all duration-300"
 class:overflow-y-auto={sidebarVisible}
 style={sidebarVisible ? '' : 'width: 0; min-width: 0; overflow: hidden; border-left: none;'}
>
 {@render headerContent()}
 {@render mainContent()}
</div>

<!-- Mobile overlay -->
{#if sidebarVisible}
 <div class="xl:hidden fixed inset-0 z-300">
 <!-- svelte-ignore a11y_click_events_have_key_events -->
 <!-- svelte-ignore a11y_no_static_element_interactions -->
 <div class="absolute inset-0 bg-black/50" onclick={onclose}></div>
 <div class="absolute right-0 w-full bg-surface shadow-xl flex flex-col" style="top: 0px; height: 100%; transition: top 300ms ease-out, height 300ms ease-out;">
 {@render headerContent()}
 {@render mainContent()}
 </div>
 </div>
{/if}
