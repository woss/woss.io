<script lang="ts">
  import { page } from '$app/state';
  import Seo from '$lib/components/Seo.svelte';
  import { toast } from 'svelte-sonner';
  import { copyToClipboard } from '$lib/utils/clipboard';
  import { appendQueryParams } from '$lib/utils/utm';
  import { Separator, Avatar } from 'sv5ui';
  import { resolve } from '$app/paths';

  let avatarUrl = $derived(appendQueryParams('https://u.macula.link/@woss/avatar', page.data.queryParams));

  interface LinkItem {
    url: string;
    label: string;
    handle: string;
    icon: string;
    copyValue?: string;
  }

  const links: LinkItem[] = [
    {
      url: 'https://github.com/woss',
      label: 'GitHub',
      handle: '@woss',
      icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>`,
    },
    {
      url: 'https://www.linkedin.com/in/daniel-maricic/',
      label: 'LinkedIn',
      handle: '/in/daniel-maricic',
      icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`,
    },
    {
      url: 'https://mastodon.social/@woss',
      label: 'Mastodon',
      handle: '@woss@mastodon.social',
      icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.268 5.313c-.35-2.578-2.617-4.634-5.266-5.073C17.254.134 15.5.008 12 .008S6.746.135 5.998.24C3.35.679 1.083 2.735.732 5.313.527 6.987.526 8.665.53 10.339c.004 1.888-.001 3.776.063 5.663.068 1.944.435 3.84 1.263 5.579C3.107 23.984 6.115 26 11.948 26c.388 0 .777-.008 1.175-.024 2.359-.089 4.772-.476 6.227-1.36l.064-.035c.048-.027.092-.042.092-.042v-3.424s-3.346.724-4.562.724c-1.631 0-2.64-.6-3.466-1.46-.6-.615-1.122-1.443-1.404-2.623 3.054 1.098 5.89.401 7.67.033.275-.058.547-.118.82-.185 2.04-.522 3.99-2.439 4.315-5.415.124-1.157.172-2.343.19-3.422.01-.408.015-.852.016-1.332 0-.126 0-.256-.002-.39 0 0 .001-.142-.002-.428z"/></svg>`,
    },
    {
      url: 'https://twitter.com/woss_io',
      label: 'X',
      handle: '@woss_io',
      icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
    },
    {
      url: 'https://woss.photo',
      label: 'Photo Portfolio',
      handle: 'woss.photo',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
    },
    {
      url: 'https://stackoverflow.com/users/2764898/woss',
      label: 'Stack Overflow',
      handle: '/u/2764898',
      icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.986 21.865v-6.404h2.134V24H1.844v-8.539h2.13v6.404h15.012zM6.111 19.731H16.85v-2.137H6.111v2.137zm.259-4.852l10.48 2.189.451-2.07-10.478-2.187-.453 2.068zm1.359-5.056l9.705 4.53.903-1.95-9.706-4.53-.902 1.95zm3.511-4.877l8.22 6.749 1.341-1.637-8.22-6.75-1.341 1.638zM15.791.003l-1.74 1.26 6.29 8.68 1.74-1.26L15.79.003z"/></svg>`,
    },
    {
      url: 'https://www.youtube.com/@woss_io',
      label: 'YouTube',
      handle: '@woss_io',
      icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`,
    },
    {
      url: 'https://u.macula.link/@woss/',
      label: 'Macula',
      handle: '@woss',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
    },
    {
      url: '',
      label: 'PGP Public Key',
      handle: 'E564 5057 B29E 272A 0E78 5778 3A6C 79F5 30FF 78EA',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`,
      copyValue: 'E5645057B29E272A0E7857783A6C79F530FF78EA',
    },
  ];

  function copyFingerprint(value: string): void {
    if (copyToClipboard(value)) {
      toast.success('Fingerprint copied');
    } else {
      toast.error('Failed to copy');
    }
  }
</script>

<Seo title="About — woss.io" description="About @woss — developer, builder, and open source enthusiast" />

<section class="max-w-200 mx-auto px-6 py-12 pb-24">
  <header class="mb-12">
    <h1 class="font-heading text-4xl font-bold text-on-surface tracking-[-0.03em] uppercase m-0">About</h1>
    <Separator color="primary" size="xs" class="w-16 mt-3" ui={{ border: 'bg-[linear-gradient(90deg,var(--color-primary),var(--color-secondary))]' }} />
  </header>

  <div class="bg-surface-container border border-[rgba(255,255,255,0.08)] rounded-lg p-8">
    <div class="flex items-center gap-6 mb-8 max-md:flex-col max-md:text-center">
      <Avatar
        src={avatarUrl}
        alt="Daniel Maricic"
        size="xl"
        class="ring-2 ring-primary/20"
      />
      <div>
        <p class="font-heading text-2xl text-on-surface m-0">Daniel Maricic</p>
        <p class="font-body text-sm text-on-surface-variant mt-1 m-0 max-w-md max-md:mx-auto">
          Forever learn and educate along the way. Always question the status-quo
        </p>
      </div>
    </div>

    <div class="font-body text-sm/relaxed text-on-surface-variant space-y-4 max-md:px-0">
      <p>
        My career defies linear progression — I jumped from blockchain protocol design with zero prior knowledge to
        content rights architecture to AI adoption strategy, each time rewiring my thinking and mastering an entirely
        new vocabulary.
      </p>
      <p>
        I treat learning as a creative act, not a prerequisite: I discovered Docker on client projects and evangelized
        it before it was mainstream, then did the same with AI tooling at Ipsos — I'd rather build first and ask
        permission later.
      </p>
      <p>
        My non-linear thinking surfaces in how I connect unconnected worlds: I wrote EU grant proposals blending
        technical vision with policy language, built a content rights platform bridging blockchain and AI, and designed
        developer experiences shaped by years of being both builder and user.
      </p>
      <p>
        Instead of optimizing what already exists, I invent what hasn't been built yet — driven less by filling a resume
        gap and more by the pull of a blank page.
      </p>
      <p>
        For a lot more info you can checkout a longer version I wrote about my career and open source contributions <a
          href={resolve('/posts/about-daniel-maricic')}
          class="text-primary hover:underline">About Me</a
        >.
      </p>
    </div>

    <Separator color="primary" size="xs" class="my-6" ui={{ border: 'bg-[linear-gradient(90deg,var(--color-primary),var(--color-secondary))]' }} />

    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      {#each links as link, i (link.url)}
        {#if link.copyValue}
          <button
            onclick={() => copyFingerprint(link.copyValue!)}
            class="flex items-center gap-4 p-4 rounded-lg border border-[rgba(255,255,255,0.08)] transition-all duration-200 hover:border-primary hover:shadow-[0_0_20px_rgba(0,255,136,0.15)] group text-left w-full cursor-pointer {i ===
            links.length - 1
              ? 'md:col-span-2'
              : ''}"
          >
            <div
              class="shrink-0 size-10 flex items-center justify-center rounded-lg bg-surface-container-high text-on-surface-variant group-hover:text-primary transition-colors duration-200"
            >
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html link.icon}
            </div>
            <div class="min-w-0 flex-1">
              <p class="font-body text-sm font-semibold text-on-surface m-0">{link.label}</p>
              <p class="font-body text-xs text-on-surface-variant m-0 truncate">{link.handle}</p>
            </div>
            <svg
              class="shrink-0 size-4 text-on-surface-variant group-hover:text-primary transition-colors duration-200"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          </button>
        {:else}
          <!-- eslint-disable svelte/no-navigation-without-resolve -->
          <a
            href={link.url}
            target={link.url.startsWith('http') ? '_blank' : undefined}
            rel={link.url.startsWith('http') ? 'noopener noreferrer' : undefined}
            class="flex items-center gap-4 p-4 rounded-lg border border-[rgba(255,255,255,0.08)] no-underline transition-all duration-200 hover:border-primary hover:shadow-[0_0_20px_rgba(0,255,136,0.15)] group {i ===
            links.length - 1
              ? 'md:col-span-2'
              : ''}"
          >
            <div
              class="shrink-0 size-10 flex items-center justify-center rounded-lg bg-surface-container-high text-on-surface-variant group-hover:text-primary transition-colors duration-200"
            >
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html link.icon}
            </div>
            <div class="min-w-0 flex-1">
              <p class="font-body text-sm font-semibold text-on-surface m-0">{link.label}</p>
              <p class="font-body text-xs text-on-surface-variant m-0 truncate">{link.handle}</p>
            </div>
            {#if link.url.startsWith('http')}
              <svg
                class="shrink-0 size-4 text-on-surface-variant group-hover:text-primary transition-colors duration-200"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M7 17L17 7" /><path d="M7 7h10v10" />
              </svg>
            {/if}
          </a>
          <!-- eslint-enable svelte/no-navigation-without-resolve -->
        {/if}
      {/each}
    </div>
  </div>
</section>
