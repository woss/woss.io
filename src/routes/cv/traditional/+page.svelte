<svelte:head>
  <title>CV — Daniel Maricic (Traditional)</title>
</svelte:head>

<div class="print-wrapper">
  <div class="cv-page">

    <!-- ═══════ Sidebar ═══════ -->
    <aside class="sidebar">
      <div class="sidebar-inner">
        <!-- Avatar/Initial -->
        <div class="avatar">DM</div>

        <!-- Name -->
        <h1 class="name">Daniel Maricic</h1>
        <p class="title">System Architect & Developer</p>

        <!-- Contact -->
        <section class="section">
          <h2 class="section-heading">Contact</h2>
          <div class="contact-grid">
            <div class="contact-item">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
              <span>Remote</span>
            </div>
            <div class="contact-item">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
              <span>woss.io</span>
            </div>
            <div class="contact-item">
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 3 5 3 5 3c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>
              <span>github.com/woss</span>
            </div>
          </div>
        </section>

        <!-- Skills -->
        <section class="section">
          <h2 class="section-heading">Skills</h2>

          <div class="skill-group">
            <h3 class="skill-category">Languages</h3>
            <p class="skill-list">TypeScript, Python, Rust, Go, Solidity, SQL</p>
          </div>

          <div class="skill-group">
            <h3 class="skill-category">Infrastructure</h3>
            <p class="skill-list">Kubernetes, Docker, CI/CD, Cloud</p>
          </div>

          <div class="skill-group">
            <h3 class="skill-category">Blockchain</h3>
            <p class="skill-list">Protocol design, Smart contracts</p>
          </div>

          <div class="skill-group">
            <h3 class="skill-category">Web</h3>
            <p class="skill-list">SvelteKit, Tailwind, Full-stack</p>
          </div>
        </section>
      </div>
    </aside>

    <!-- ═══════ Main Content ═══════ -->
    <main class="main">
      <!-- Summary -->
      <section class="main-section">
        <h2 class="main-heading">Summary</h2>
        <p class="summary-text">
          System architect and full-stack developer building AI-native portfolios,
          decentralized systems, and digital asset management platforms. Creator of
          Macula DAM and woss.io.
        </p>
      </section>

      <!-- Experience -->
      <section class="main-section">
        <h2 class="main-heading">Experience</h2>

        <div class="experience-item">
          <div class="exp-header">
            <h3 class="exp-title">Founder &amp; System Architect</h3>
            <span class="exp-org">woss.io</span>
          </div>
          <p class="exp-desc">
            Building woss.io, an interactive AI-native portfolio with chat-based
            CV evaluation.
          </p>
        </div>

        <div class="experience-item">
          <div class="exp-header">
            <h3 class="exp-title">Creator</h3>
            <span class="exp-org">Macula DAM</span>
          </div>
          <p class="exp-desc">
            Digital asset management platform with decentralized storage.
          </p>
        </div>

        <div class="experience-item">
          <div class="exp-header">
            <h3 class="exp-title">Blockchain Protocol Engineer</h3>
          </div>
          <p class="exp-desc">
            Protocol design and development, smart contract architecture.
          </p>
        </div>

        <div class="experience-item">
          <div class="exp-header">
            <h3 class="exp-title">DevOps / Infrastructure</h3>
          </div>
          <p class="exp-desc">
            Kubernetes, CI/CD, cloud infrastructure.
          </p>
        </div>
      </section>
    </main>
  </div>
</div>

<style>
  @reference "../../../app.css";

  /* ─── Layout ─── */
  .print-wrapper {
    @apply bg-surface min-h-screen flex justify-center py-12 px-4;
  }

  .cv-page {
    @apply bg-surface-container-low border border-outline-variant rounded-xl max-w-[900px] w-full;
    display: grid;
    grid-template-columns: 280px 1fr;
    overflow: hidden;
  }

  /* ─── Sidebar ─── */
  .sidebar {
    @apply bg-surface-container-high border-r border-outline-variant;
  }

  .sidebar-inner {
    @apply p-6 flex flex-col gap-5;
  }

  .avatar {
    @apply size-14 rounded-lg flex items-center justify-center font-heading font-bold text-lg;
    background: oklch(0.72 0.19 162.5);
    color: oklch(0.15 0.02 160);
  }

  .name {
    @apply font-heading text-xl font-bold text-on-surface tracking-[-0.02em] leading-tight;
  }

  .title {
    @apply text-sm font-body text-on-surface-variant leading-snug;
  }

  /* ─── Sections ─── */
  .section {
    @apply flex flex-col gap-2.5;
  }

  .section-heading {
    @apply font-heading text-xs font-bold uppercase tracking-[0.1em];
    color: oklch(0.72 0.19 162.5);
  }

  .contact-grid {
    @apply flex flex-col gap-2;
  }

  .contact-item {
    @apply flex items-center gap-2 text-sm font-body text-on-surface-variant;
  }

  .icon {
    @apply size-3.5 shrink-0;
    color: oklch(0.72 0.19 162.5);
  }

  .skill-group {
    @apply mb-3;
  }

  .skill-group:last-child {
    @apply mb-0;
  }

  .skill-category {
    @apply font-heading text-xs font-semibold tracking-[0.05em] text-on-surface mb-1;
  }

  .skill-list {
    @apply text-sm font-body text-on-surface-variant leading-relaxed;
  }

  /* ─── Main ─── */
  .main {
    @apply p-6 flex flex-col gap-6;
  }

  .main-section {
    @apply flex flex-col gap-3;
  }

  .main-heading {
    @apply font-heading text-base font-bold tracking-[-0.01em];
    color: oklch(0.72 0.19 162.5);
  }

  .summary-text {
    @apply text-sm font-body text-on-surface leading-relaxed;
  }

  .experience-item {
    @apply pb-4 mb-4;
    border-bottom: 1px solid var(--color-outline-variant);
  }

  .experience-item:last-child {
    @apply pb-0 mb-0 border-b-0;
  }

  .exp-header {
    @apply flex items-baseline gap-2 mb-1;
  }

  .exp-title {
    @apply font-heading text-sm font-bold text-on-surface;
  }

  .exp-org {
    @apply text-xs font-body;
    color: oklch(0.72 0.19 162.5);
  }

  .exp-desc {
    @apply text-sm font-body text-on-surface-variant leading-relaxed;
  }

  /* ─── Print Styles ─── */
  @media print {
    @page {
      size: A4;
      margin: 0;
    }

    :global(body) {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    :global(nav),
    :global(footer),
    :global([class*="print-hide"]) {
      display: none !important;
    }

    .print-wrapper {
      @apply min-h-screen py-0 px-0;
      background: white !important;
    }

    .cv-page {
      @apply border-0 rounded-none max-w-full;
      background: white !important;
      grid-template-columns: 220px 1fr;
      min-height: 297mm;
    }

    .sidebar {
      @apply border-r-0;
      background: #f5f5f5 !important;
    }

    .sidebar-inner {
      @apply p-5;
    }

    .avatar {
      background: #00da8c !important;
      color: #111 !important;
    }

    .section-heading {
      color: #00a36c !important;
    }

    .icon {
      color: #00a36c !important;
    }

    .main-heading {
      color: #00a36c !important;
    }

    .exp-org {
      color: #00a36c !important;
    }

    .name {
      color: #1a1a1a !important;
    }

    .title,
    .contact-item,
    .skill-list,
    .summary-text,
    .exp-desc {
      color: #333 !important;
    }

    .exp-title,
    .skill-category {
      color: #1a1a1a !important;
    }

    .cv-page {
      color: #1a1a1a !important;
    }

    .main {
      background: white !important;
    }

    .experience-item {
      border-bottom-color: #e0e0e0 !important;
    }
  }
</style>
