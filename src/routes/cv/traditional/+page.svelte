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

  @page {
    size: A4;
    margin: 0;
  }


  /* ─── Layout ─── */
  .print-wrapper {
    background: var(--color-surface);
    display: flex;
    justify-content: center;
    padding: 3rem 1rem;
  }

  .cv-page {
    background: var(--color-surface-container-low);
    border: 1px solid var(--color-outline-variant);
    border-radius: 0.75rem;
    max-width: 900px;
    width: 100%;
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
    width: 3.5rem;
    height: 3.5rem;
    border-radius: 0.5rem;
    object-fit: cover;
    flex-shrink: 0;
  }

  .header-text {
    display: flex;
    flex-direction: column;
  }

  .name {
    font-family: var(--font-heading);
    font-weight: 700;
    color: var(--color-on-surface);
    font-size: 28px;
    letter-spacing: -0.03em;
    line-height: 1.15;
  }

  .subtitle {
    font-family: var(--font-body);
    font-size: 0.875rem;
    line-height: 1.4;
    color: var(--color-on-surface-variant);
    margin-top: 2px;
  }

  .links {
    font-family: var(--font-body);
    font-size: 0.75rem;
    line-height: 1.35;
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
    font-family: var(--font-heading);
    font-weight: 700;
    color: oklch(0.72 0.19 162.5);
    text-decoration: none;
  }
  .link-modern:hover {
    text-decoration: underline;
  }

  .contact-row {
    font-family: var(--font-body);
    font-size: 0.75rem;
    line-height: 1.35;
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
    font-family: var(--font-body);
    font-size: 0.875rem;
    line-height: 1.625;
    color: var(--color-on-surface-variant);
    margin-bottom: 16px;
  }
  .summary.secondary {
    margin-bottom: 24px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--color-outline-variant);
  }

  /* ─── Section ─── */
  .section-heading {
    font-family: var(--font-heading);
    font-weight: 700;
    font-size: 0.75rem;
    line-height: 1.35;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: oklch(0.72 0.19 162.5);
    margin-bottom: 16px;
  }

  /* ─── Experience ─── */
  .entry {
    margin-bottom: 1.25rem;
    padding-bottom: 1.25rem;
    border-bottom: 1px solid var(--color-outline-variant);
    page-break-inside: avoid;
  }
  .entry:last-child {
    margin-bottom: 0;
    padding-bottom: 0;
    border-bottom: none;
  }

  .entry-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 2px;
  }

  .entry-company {
    font-family: var(--font-heading);
    font-weight: 700;
    font-size: 0.75rem;
    line-height: 1.35;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: oklch(0.72 0.19 162.5);
  }

  .entry-duration {
    font-family: var(--font-body);
    font-size: 0.75rem;
    line-height: 1.35;
    color: var(--color-outline-strong);
  }

  .entry-title {
    font-family: var(--font-heading);
    font-weight: 700;
    font-size: 1rem;
    color: var(--color-on-surface);
    margin-bottom: 2px;
    line-height: 1.3;
  }

  .entry-role-desc {
    font-family: var(--font-body);
    font-size: 0.875rem;
    font-style: italic;
    line-height: 1.625;
    color: var(--color-on-surface-variant);
    margin-bottom: 6px;
  }

  .entry-desc {
    font-family: var(--font-body);
    font-size: 0.875rem;
    line-height: 1.625;
    color: var(--color-on-surface-variant);
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
      padding: 0;
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
