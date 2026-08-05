<script lang="ts">
  import { page } from '$app/state';
  import Seo from '$lib/components/Seo.svelte';
</script>

<Seo
  title="Privacy Policy — woss.io"
  description="Privacy policy for woss.io — what data is collected, why, and how to manage your preferences."
  url={`${page.url.origin}/privacy`}
/>

<div class="mx-auto max-w-3xl px-6 py-16">
  <h1 class="font-heading text-4xl font-bold text-on-surface tracking-[-0.03em] m-0 mb-2">Privacy Policy</h1>
  <p class="text-sm text-on-surface-variant font-mono mb-12">Last updated: August 5, 2026</p>

  <section class="prose prose-invert max-w-none space-y-8">
    <div>
      <h2 class="font-heading text-xl font-bold text-on-surface m-0 mb-3">Data Collected</h2>
      <p class="text-sm/relaxed text-on-surface-variant m-0">
        woss.io does not use third-party analytics, tracking, or monitoring services. A small number of preferences
        (such as your sound and chat-sidebar preferences, an anonymous chat identifier, and whether the chat prompt has
        been dismissed) are stored in your browser's localStorage so the site can remember your choices between visits.
        These preferences never leave your device.
      </p>
      <p class="text-sm/relaxed text-on-surface-variant m-0">
        Images displayed on this site are hosted on <code>u.macula.link</code>, a media asset server (Macula DAM).
      </p>
    </div>

    <div>
      <h2 class="font-heading text-xl font-bold text-on-surface m-0 mb-3">Cookies</h2>
      <p class="text-sm/relaxed text-on-surface-variant m-0">
        This site does not set tracking cookies. Preferences are stored in your browser's localStorage and never leave
        your device.
      </p>
    </div>

    <div>
      <h2 class="font-heading text-xl font-bold text-on-surface m-0 mb-3">Your Rights</h2>
      <p class="text-sm/relaxed text-on-surface-variant m-0">Under GDPR, you have the right to:</p>
      <ul class="text-sm/relaxed text-on-surface-variant pl-5 space-y-1">
        <li>Request access to your personal data</li>
        <li>Request deletion of your data</li>
        <li>Object to processing</li>
      </ul>
      <p class="text-sm/relaxed text-on-surface-variant m-0">
        To exercise these rights, contact <a
          href="mailto:woss@woss.io"
          class="text-secondary underline hover:text-primary">woss@woss.io</a
        >.
      </p>
    </div>

    <div>
      <h2 class="font-heading text-xl font-bold text-on-surface m-0 mb-3">Contact</h2>
      <p class="text-sm/relaxed text-on-surface-variant m-0">
        For privacy-related inquiries: <a href="mailto:woss@woss.io" class="text-secondary underline hover:text-primary"
          >woss@woss.io</a
        >
      </p>
    </div>
  </section>
</div>
