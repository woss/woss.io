<script lang="ts">
  import { resolve } from '$app/paths';

  let {
    data,
  }: {
    data: {
      experience: Array<{
        slug: string;
        company: string;
        role: string;
        duration: string;
        description: string;
        jobRole: string;
        skills: string[];
      }>;
    };
  } = $props();
</script>

<svelte:head>
  <title>CV — Daniel Maricic (Traditional)</title>
</svelte:head>

<div class="print-wrapper">
  <div class="cv-page">
    <!-- ═══════ Header ═══════ -->
    <header class="cv-header">
      <img class="avatar" src="https://u.macula.link/kPT78FuvSm2Y_3BQHPApYg-7?preset=sys_md" alt="Daniel Maricic" />
      <div class="header-text">
        <h1 class="name">Daniel Maricic</h1>
        <p class="subtitle">Platform / System Engineer &middot; DevOps &middot; AI Adoption Lead</p>
        <p class="links">
          <a class="link-traditional" href="https://woss.io/cv/traditional"> You are reading traditional cv</a>
          &middot; <a class="link-modern" href={resolve('/cv')}>Check modern CV →</a>
        </p>
        <div class="contact-row">
          <span>Remote</span>
          <span class="contact-dot">&middot;</span>
          <span>woss.io</span>
          <span class="contact-dot">&middot;</span>
          <span>github.com/woss</span>
        </div>
      </div>
    </header>

    <!-- ═══════ Summary ═══════ -->
    <p class="summary">
      System architect and full-stack developer building AI-native portfolios, decentralized systems, and digital asset
      management platforms. Creator of Macula DAM and woss.io.
    </p>
    <p class="summary secondary">Forever learn and educate along the way. Always question the status-quo.</p>

    <!-- ═══════ Experience ═══════ -->
    <section>
      <h2 class="section-heading">Experience</h2>

      {#each data.experience as exp (exp.slug)}
        <article class="entry">
          <div class="entry-header">
            {#if exp.company}
              <span class="entry-company">{exp.company}</span>
            {/if}
            {#if exp.duration}
              <span class="entry-duration">{exp.duration}</span>
            {/if}
          </div>
          <h3 class="entry-title">{exp.role}</h3>
          {#if exp.jobRole}
            <p class="entry-role-desc">{exp.jobRole}</p>
          {/if}
          {#if exp.description}
            <p class="entry-desc">{exp.description}</p>
          {/if}
        </article>
      {/each}
    </section>
  </div>
</div>

<style>
  @reference "../../../app.css";

  @page {
    size: A4;
    margin: 0;
  }

  /* ─── Layout ─── */
  .print-wrapper {
    @apply bg-surface flex justify-center py-12 px-4;
  }

  .cv-page {
    @apply bg-surface-container-low border border-outline-variant rounded-xl max-w-[900px] w-full;
    padding: 48px 56px;
  }

  /* ─── Header ─── */
  .cv-header {
    display: flex;
    gap: 24px;
    margin-bottom: 28px;
    padding-bottom: 28px;
    border-bottom: 1px solid var(--color-outline-variant);
  }

  .avatar {
    @apply size-14 rounded-lg object-cover shrink-0;
  }

  .header-text {
    @apply flex flex-col;
  }

  .name {
    @apply font-heading font-bold text-on-surface;
    font-size: 28px;
    letter-spacing: -0.03em;
    line-height: 1.15;
  }

  .subtitle {
    @apply font-body text-sm text-on-surface-variant;
    margin-top: 2px;
  }

  .links {
    @apply font-body text-xs;
    color: var(--color-on-surface-variant);
    margin-top: 6px;
  }

  .link-traditional {
    color: var(--color-on-surface-variant);
    text-decoration: none;
  }
  .link-traditional:hover {
    color: var(--color-on-surface);
    text-decoration: underline;
  }

  .link-modern {
    @apply font-heading font-bold;
    color: oklch(0.72 0.19 162.5);
    text-decoration: none;
  }
  .link-modern:hover {
    text-decoration: underline;
  }

  .contact-row {
    @apply font-body text-xs;
    color: var(--color-on-surface-variant);
    margin-top: 4px;
    display: flex;
    gap: 4px;
  }

  .contact-dot {
    color: var(--color-outline-strong);
  }

  /* ─── Summary ─── */
  .summary {
    @apply font-body text-sm text-on-surface-variant leading-relaxed;
    margin-bottom: 16px;
  }
  .summary.secondary {
    margin-bottom: 24px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--color-outline-variant);
  }



  /* ─── Section ─── */
  .section-heading {
    @apply font-heading font-bold text-xs uppercase tracking-[0.08em];
    color: oklch(0.72 0.19 162.5);
    margin-bottom: 16px;
  }

  /* ─── Experience ─── */
  .entry {
    @apply mb-5 pb-5;
    border-bottom: 1px solid var(--color-outline-variant);
    page-break-inside: avoid;
  }
  .entry:last-child {
    @apply mb-0 pb-0 border-b-0;
  }

  .entry-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 2px;
  }

  .entry-company {
    @apply font-heading font-bold text-xs uppercase tracking-[0.05em];
    color: oklch(0.72 0.19 162.5);
  }

  .entry-duration {
    @apply font-body text-xs;
    color: var(--color-outline-strong);
  }

  .entry-title {
    @apply font-heading font-bold text-base text-on-surface;
    margin-bottom: 2px;
    line-height: 1.3;
  }

  .entry-role-desc {
    @apply font-body text-sm text-on-surface-variant italic leading-relaxed;
    margin-bottom: 6px;
  }

  .entry-desc {
    @apply font-body text-sm text-on-surface-variant leading-relaxed;
    white-space: pre-wrap;
  }

  /* ─── Print Styles ─── */
  @media print {
    @page {
      size: A4;
      margin: 14mm 16mm;
    }
    :global(body) {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      font-size: 10.5pt;
    }
    :global(nav),
    :global(footer),
    :global([class*='print-hide']) {
      display: none !important;
    }
    .print-wrapper {
      @apply py-0 px-0;
      background: white !important;
    }
    .cv-page {
      padding: 0 !important;
      max-width: none;
      border: none !important;
      border-radius: 0 !important;
      background: white !important;
      color: #1a1a1a !important;
    }
    .avatar {
      width: 40px !important;
      height: 40px !important;
    }
    .name {
      color: #1a1a1a !important;
    }
    .subtitle {
      color: #555 !important;
    }
    .links {
      color: #999 !important;
    }
    .link-traditional {
      color: #999 !important;
    }
    .link-modern {
      color: #00a36c !important;
    }
    .contact-row {
      color: #999 !important;
    }
    .contact-dot {
      color: #ccc !important;
    }
    .summary {
      color: #444 !important;
      border-bottom-color: #eee !important;
    }
    .summary.secondary {
      border-bottom-color: #eee !important;
    }
    .section-heading {
      margin-bottom: 8px;
    }
    .section-heading {
      color: #00a36c !important;
    }
    .entry {
      border-bottom-color: #eee !important;
    }
    .entry-company {
      color: #888 !important;
    }
    .entry-duration {
      color: #aaa !important;
    }
    .entry-title {
      color: #1a1a1a !important;
    }
    .entry-role-desc {
      color: #555 !important;
    }
    .entry-desc {
      color: #444 !important;
    }
  }
</style>
