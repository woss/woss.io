<script lang="ts">
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { appendQueryParams } from '$lib/utils/utm';
  import { Toaster } from 'svelte-sonner';
  import { Button, Drawer } from 'sv5ui';

  import '../app.css';

  // Font @font-face declarations (font-display: swap — mitigated by preload)
  import '@fontsource-variable/ibm-plex-sans';
  import '@fontsource-variable/ibm-plex-sans/wght-italic.css';
  import '@fontsource/ibm-plex-mono/400.css';
  import '@fontsource/ibm-plex-mono/700.css';

  // Font WOFF2 URLs for preload hints in <svelte:head>
  import ibmPlexSansNormal from '@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2?url';
  import ibmPlexSansItalic from '@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-italic.woff2?url';
  import ibmPlexMono400 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?url';
  import ibmPlexMono700 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-700-normal.woff2?url';

  let avatarUrl = $derived(appendQueryParams('https://u.macula.link/@woss/avatar', page.data.queryParams));

  let { children } = $props();

  let mobileMenuOpen = $state(false);
  const navLinks = [
    { href: '/', label: 'Home' },
    { href: '/experience', label: 'Experience' },
    { href: '/posts', label: 'Posts' },
    { href: '/about', label: 'About' },
  ] as const;

  function isActive(href: string): boolean {
    if (href === '/') return page.url.pathname === '/';
    return page.url.pathname.startsWith(href);
  }

  let isChatPage = $derived(page.url.pathname.startsWith('/chat/'));

  function closeMobileMenu() {
    mobileMenuOpen = false;
  }

  // Close mobile menu on route navigation
  $effect(() => {
    void page.url.pathname;
    mobileMenuOpen = false;
  });
</script>

<svelte:head>
  <link rel="icon" href={avatarUrl} />
  <link rel="apple-touch-icon" href={avatarUrl} />
  <link rel="preload" href={ibmPlexSansNormal} as="font" crossorigin="anonymous" type="font/woff2" />
  <link rel="preload" href={ibmPlexSansItalic} as="font" crossorigin="anonymous" type="font/woff2" />
  <link rel="preload" href={ibmPlexMono400} as="font" crossorigin="anonymous" type="font/woff2" />
  <link rel="preload" href={ibmPlexMono700} as="font" crossorigin="anonymous" type="font/woff2" />
</svelte:head>

<div class="flex flex-col" style="height: 100dvh">
  {#if !isChatPage}
    <nav
      aria-label="Main navigation"
      class="shrink-0 h-(--nav-height) bg-surface/80 backdrop-blur-md border-b border-[rgba(255,255,255,0.08)] max-md:bg-transparent max-md:backdrop-blur-none max-md:border-b-0"
    >
      <div class="flex items-center justify-between h-full mx-auto px-8 max-md:px-4">
        <a
          href={resolve('/')}
          class="font-heading text-xl font-bold text-primary no-underline tracking-[-0.02em] hover:text-white transition-colors duration-150"
        >
          <img src={avatarUrl} alt="woss.io logo" width="32" height="32" class="size-8" />
        </a>

        <div class="hidden md:flex items-center gap-8">
          {#each navLinks as link (link.href)}
            <a
              href={resolve(link.href)}
              class="text-on-surface-variant no-underline font-body text-sm font-medium tracking-[0.04em] uppercase py-1 hover:text-white transition-colors duration-150 border-b-2 border-transparent"
              class:text-primary={isActive(link.href)}
              class:border-primary={isActive(link.href)}
            >
              {link.label}
            </a>
          {/each}
        </div>

        <Button
          variant="outline" square size="md"
          icon={mobileMenuOpen ? 'lucide:x' : 'lucide:menu'}
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileMenuOpen}
          onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
          class="md:hidden"
        />
      </div>
    </nav>

    <!-- Mobile menu drawer -->
    <Drawer
      bind:open={mobileMenuOpen}
      direction="top"
      class="h-dvh max-h-dvh"
      overlay
      modal
      dismissible
      handle={false}
      noBodyStyles
    >
      {#snippet body()}
        <div class="relative flex flex-col items-center justify-center gap-12 min-h-dvh">
          <div class="absolute top-4 right-4">
            <Button
              variant="ghost" square size="md"
              icon="lucide:x"
              aria-label="Close menu"
              onclick={closeMobileMenu}
            />
          </div>
          {#each navLinks as link (link.href)}
            <a
              href={resolve(link.href)}
              class="no-underline font-heading text-3xl font-bold tracking-[-0.02em] text-on-surface-variant hover:text-white transition-colors duration-150"
              class:text-primary={isActive(link.href)}
            >
              {link.label}
            </a>
          {/each}
          <Button
            variant="ghost"
            onclick={() => {
              closeMobileMenu();
              goto(resolve('/chat'));
            }}
            class="font-heading text-3xl font-bold tracking-[-0.02em] text-on-surface-variant hover:text-white [&>button]:text-inherit [&>button]:text-3xl"
          >
            Chats
          </Button>
        </div>
      {/snippet}
    </Drawer>
  {/if}

  <Toaster />

  <main 
    class="mx-auto w-full flex-1 min-h-0 flex flex-col"
    class:overflow-y-auto={!isChatPage}
    class:overflow-hidden={isChatPage}
  >
    {@render children()}
  </main>
</div>
