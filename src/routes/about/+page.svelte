<script lang="ts">
  import { page } from '$app/state';
  import Seo from '$lib/components/Seo.svelte';
  import { toast } from 'svelte-sonner';
  import { copyToClipboard } from '$lib/utils/clipboard';
  import { appendQueryParams } from '$lib/utils/utm';
  import { Separator, Avatar } from 'sv5ui';
  import { resolve } from '$app/paths';
  import Icon from '$lib/icons/Icon.svelte';

  let avatarUrl = $derived(appendQueryParams('https://u.macula.link/kPT78FuvSm2Y_3BQHPApYg-7?preset=sys_md', page.data.queryParams));

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
      icon: 'github',
    },
    {
      url: 'https://www.linkedin.com/in/daniel-maricic/',
      label: 'LinkedIn',
      handle: '/in/daniel-maricic',
      icon: 'linkedin',
    },
    {
      url: 'https://mastodon.social/@woss',
      label: 'Mastodon',
      handle: '@woss@mastodon.social',
      icon: 'mastodon',
    },
    {
      url: 'https://twitter.com/woss_io',
      label: 'X',
      handle: '@woss_io',
      icon: 'x',
    },
    {
      url: 'https://woss.photo',
      label: 'Photo Portfolio',
      handle: 'woss.photo',
      icon: 'portfolio',
    },
    {
      url: 'https://stackoverflow.com/users/2764898/woss',
      label: 'Stack Overflow',
      handle: '/u/2764898',
      icon: 'stackoverflow',
    },
    {
      url: 'https://www.youtube.com/@woss_io',
      label: 'YouTube',
      handle: '@woss_io',
      icon: 'youtube',
    },
    {
      url: 'https://u.macula.link/@woss/',
      label: 'Macula',
      handle: '@woss',
      icon: 'macula',
    },
    {
      url: '',
      label: 'PGP Public Key',
      handle: 'E564 5057 B29E 272A 0E78 5778 3A6C 79F5 30FF 78EA',
      icon: 'lock',
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
          Forever learn and educate along the way. Always question the status-quo — Barcelona
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
              <Icon name={link.icon} />
            </div>
            <div class="min-w-0 flex-1">
              <p class="font-body text-sm font-semibold text-on-surface m-0">{link.label}</p>
              <p class="font-body text-xs text-on-surface-variant m-0 truncate">{link.handle}</p>
            </div>
            <Icon name="copy" class="shrink-0 size-4 text-on-surface-variant group-hover:text-primary transition-colors duration-200" />
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
              <Icon name={link.icon} />
            </div>
            <div class="min-w-0 flex-1">
              <p class="font-body text-sm font-semibold text-on-surface m-0">{link.label}</p>
              <p class="font-body text-xs text-on-surface-variant m-0 truncate">{link.handle}</p>
            </div>
            {#if link.url.startsWith('http')}
              <Icon name="external-link" class="shrink-0 size-4 text-on-surface-variant group-hover:text-primary transition-colors duration-200" />
            {/if}
          </a>
          <!-- eslint-enable svelte/no-navigation-without-resolve -->
        {/if}
      {/each}
    </div>
  </div>
</section>
