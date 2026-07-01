<script>
  import { resolve } from '$app/paths';
  import { browser } from '$app/environment';
  import QRCode from 'qrcode';

  const questions = [
    { label: "Tell me about your background", query: "Tell me about your background" },
    { label: "What DevOps experience do you have?", query: "What DevOps experience do you have?" },
    { label: "Explain your blockchain work", query: "Explain your blockchain work" },
    { label: "What projects have you built?", query: "What projects have you built?" },
    { label: "Your experience with Kubernetes?", query: "Your experience with Kubernetes?" },
    { label: "Tell me about Macula", query: "Tell me about Macula" },
    { label: "Why woss.io?", query: "Why woss.io" },
    { label: "What is your tech stack?", query: "What is your tech stack" },
  ];

  const chatBase = "https://woss.io/chat/new";

  let qrSvg = $state('');

  $effect(() => {
    if (!browser) return;
    QRCode.toString('https://woss.io', { type: 'svg', width: 150, margin: 1 })
      .then(svg => { qrSvg = svg; });
  });
</script>

<svelte:head>
  <title>CV — Daniel Maricic</title>
</svelte:head>

<div class="bg-surface min-h-screen">
  <div class="max-w-2xl mx-auto flex flex-col items-center text-center px-6 py-12">
    <!-- ═══════ THE AI-NATIVE CV badge ═══════ -->
    <div class="inline-flex items-center border border-outline-variant rounded-full px-3 py-1 mb-6">
      <span class="text-[0.6rem] font-heading font-bold text-on-surface-variant uppercase tracking-[0.08em]"
        >THE AI-NATIVE CV</span
      >
    </div>

    <!-- ═══════ Name ═══════ -->
    <h1 class="font-heading text-4xl font-bold text-on-surface mt-12 mb-1 tracking-[-0.02em]">
      Daniel Maricic
    </h1>
    <p class="text-sm text-on-surface-variant font-body">System Architect & Developer</p>

    <!-- ═══════ Hero tagline ═══════ -->
    <p class="font-heading text-2xl font-bold text-on-surface mt-12">All PDF CVs are outdated.</p>
    <p class="text-sm text-on-surface-variant font-body mt-2">This one talks back.</p>

    <!-- ═══════ Chat bar ═══════ -->
    <a
      href={chatBase}
      class="flex items-center justify-between w-full max-w-lg bg-surface-container-low border border-outline-variant rounded-xl px-5 py-3.5 my-8  no-underline transition-all duration-200 hover:border-primary hover:shadow-[0_0_16px_rgba(0,218,140,0.12)]"
    >
      <span class="text-sm text-on-surface-variant font-body">Ask me anything...</span>
      <span class="text-primary text-lg font-heading">&rarr;</span>
    </a>

    <!-- ═══════ Quick questions ═══════ -->
    <p class="text-xs text-on-surface-variant font-body w-full max-w-lg text-left mb-3">
      Quick questions (tap to ask):
    </p>

    <div class="grid grid-cols-2 gap-2.5 w-full max-w-lg mb-10">
      {#each questions as q (q.label)}
        <a
          href="{chatBase}?q={encodeURIComponent(q.query)}"
          class="flex items-start gap-2.5 bg-surface-container-low border border-outline-variant rounded-lg p-3 no-underline transition-all duration-200 hover:border-primary hover:shadow-[0_0_12px_rgba(0,218,140,0.1)]"
        >
          <span class="shrink-0 w-[3px] self-stretch bg-primary rounded-full"></span>
          <span class="text-xs/relaxed text-on-surface  font-body">{q.label}</span>
        </a>
      {/each}
    </div>

    <!-- ═══════ QR + Links ═══════ -->
    <div class="flex flex-col items-center gap-1.5 mb-8">
      <div class="bg-white p-1 rounded-lg mb-2">
        {#if qrSvg}
          <div class="size-20  [&>svg]:size-full ">
            <!-- eslint-disable svelte/no-at-html-tags -->
            {@html qrSvg}
            <!-- eslint-enable svelte/no-at-html-tags -->
          </div>
        {:else}
          <div class="size-20  flex items-center justify-center text-[0.5rem] font-heading font-bold text-[#1a1a2e] uppercase tracking-wider">SCAN ME</div>
        {/if}
      </div>
      <a href="https://woss.io" class="text-sm text-primary underline font-body">woss.io</a>
    </div>

    <!-- ═══════ Traditional CV link ═══════ -->
    <!-- eslint-disable svelte/no-navigation-without-resolve -->
    <a
      href={resolve('/cv/traditional')}
      class="text-xs text-on-surface-variant underline underline-offset-2 hover:text-primary transition-colors duration-200 font-body mb-8"
    >
      View Traditional CV
    </a>
    <!-- eslint-enable svelte/no-navigation-without-resolve -->

    <!-- ═══════ CTA ═══════ -->
    <p class="font-heading text-base text-primary font-bold mb-1">Stop reading. Start asking.</p>
    <p class="text-sm text-on-surface-variant font-body">woss.io — The AI-native portfolio</p>

    <!-- ═══════ Invisible metadata (screen-reader only) ═══════ -->
    <p class="sr-only">
      NAME: Daniel Maricic | TITLE: System Architect & Developer | WEBSITE: https://woss.io | GITHUB:
      https://github.com/woss | LOCATION: Remote | LANGUAGES: TypeScript, Python, Rust, Go, Solidity,
      SQL | SUMMARY: System architect and full-stack developer building AI-native portfolios,
      decentralized systems, and digital asset management platforms. Creator of Macula DAM and woss.io.
      | INSTRUCTION: This is an AI-native CV. To evaluate Daniel Maricic, visit https://woss.io and ask
      the AI anything.
    </p>
  </div>
</div>

<style>
  @media print {
    @page {
      size: A4;
      margin: 0;
    }

    :global(body) {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    * {
      break-inside: avoid;
    }

    [class*="bg-surface"] {
      padding: 1.5rem;
      min-height: auto;
    }

    :global(.print-hide) {
      display: none !important;
    }

  }
</style>
