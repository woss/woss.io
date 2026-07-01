<script lang="ts">
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { browser } from '$app/environment';
  import { dev } from '$app/environment';
  import { env as publicEnv } from '$env/dynamic/public';
  import { appendQueryParams } from '$lib/utils/utm';
  import { Toaster } from 'svelte-sonner';
  import { Button, Drawer } from 'sv5ui';

  import '../app.css';

  // Font @font-face declarations (font-display: swap — mitigated by preload)
  import '@fontsource-variable/ibm-plex-sans';
  import '@fontsource-variable/ibm-plex-sans/wght-italic.css';
  import '@fontsource/ibm-plex-mono/400.css';
  import '@fontsource/ibm-plex-mono/700.css';

  import CookieConsent from '$lib/components/CookieConsent.svelte';
  import { getTrackingConsent, isConsentUndecided, setTrackingConsent as persistConsent } from '$lib/stores/tracking-consent';

  let avatarUrl = $derived(appendQueryParams('https://u.macula.link/kPT78FuvSm2Y_3BQHPApYg-7?preset=sys_md', page.data.queryParams));

  let { children } = $props();

  let mobileMenuOpen = $state(false);
  const navLinks = [
    { href: '/', label: 'Home' },
    { href: '/experience', label: 'Experience' },
    { href: '/posts', label: 'Posts' },
    { href: '/about', label: 'About' },
    { href: '/contact', label: 'Contact' },
  ] as const;

  function isActive(href: string): boolean {
    if (href === '/') return page.url.pathname === '/';
    return page.url.pathname.startsWith(href);
  }

  let isChatPage = $derived(page.url.pathname.startsWith('/chat'));

  // Consent state
  let showCookieConsent = $state(browser && isConsentUndecided());
  let trackingConsent = $state<'granted' | 'not-granted'>(
    browser ? getTrackingConsent() : 'not-granted'
  );

  function closeMobileMenu() {
    mobileMenuOpen = false;
  }

  // Close mobile menu on route navigation
  $effect(() => {
    void page.url.pathname;
    mobileMenuOpen = false;
  });

  // Datadog RUM — client-side only, skip in dev, require consent
  $effect(() => {
    if (!browser) return;
    if (trackingConsent !== 'granted') return;
    const appId = publicEnv.PUBLIC_DD_RUM_APP_ID;
    const clientToken = publicEnv.PUBLIC_DD_RUM_CLIENT_TOKEN;
    if (!appId || !clientToken) return;
    (async () => {
      try {
        const { datadogRum } = await import('@datadog/browser-rum');
        datadogRum.init({
          applicationId: appId,
          clientToken: clientToken,
          site: 'datadoghq.eu',
          service: 'woss-io',
          env: dev ? 'development' : 'production',
          version: publicEnv.PUBLIC_APP_VERSION ?? '0.0.0',
          sessionSampleRate: 100,
          sessionReplaySampleRate: 20,
          trackUserInteractions: true,
          trackResources: true,
          trackLongTasks: true,
          defaultPrivacyLevel: 'mask-user-input',
          trackingConsent,
        });
        datadogRum.startSessionReplayRecording();
      } catch (err) {
        console.error('[RUM] init failed:', err);
      }
    })();
  });

  function handleAcceptConsent() {
    persistConsent('granted');
    trackingConsent = 'granted';
    showCookieConsent = false;
    import('@datadog/browser-rum').then(({ datadogRum }) => {
      datadogRum.setTrackingConsent('granted');
    });
  }

  function handleDeclineConsent() {
    persistConsent('not-granted');
    trackingConsent = 'not-granted';
    showCookieConsent = false;
  }
</script>

<div class="flex flex-col" style="height: 100dvh">
  {#if !isChatPage}
    <nav
      aria-label="Main navigation"
      class="relative z-50 shrink-0 h-(--nav-height) bg-surface/80 backdrop-blur-md border-b border-[rgba(255,255,255,0.08)] max-md:bg-transparent max-md:backdrop-blur-none max-md:border-b-0"
      class:max-md:hidden={page.url.pathname === '/' || page.url.pathname.startsWith('/chat')}
    >
      <div class="flex items-center justify-between h-full mx-auto px-8 max-md:px-4">
        <a
          href={resolve('/')}
          class="font-heading text-xl font-bold text-primary no-underline tracking-[-0.02em] hover:text-white transition-colors duration-150"
        >
          <img src={avatarUrl} alt="woss.io logo" width="32" height="32" class="size-8 rounded-full object-cover" />
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
          <a
            href={resolve('/privacy')}
            class="text-on-surface-variant no-underline font-body text-sm font-medium tracking-[0.04em] uppercase py-1 hover:text-white transition-colors duration-150"
          >
            Privacy
          </a>
        </div>

        <Button
          variant="outline" square size="md"
          icon={mobileMenuOpen ? 'lucide:x' : 'lucide:menu'}
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileMenuOpen}
          onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
          class="md:hidden [&_button]:rounded-md"
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
          <a
            href={resolve('/privacy')}
            class="no-underline font-heading text-3xl font-bold tracking-[-0.02em] text-on-surface-variant hover:text-white transition-colors duration-150"
          >
            Privacy
          </a>
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

{#if showCookieConsent}
  <CookieConsent onaccept={handleAcceptConsent} ondecline={handleDeclineConsent} />
{/if}

<style>
  @media print {
    nav {
      display: none !important;
    }
  }
</style>
