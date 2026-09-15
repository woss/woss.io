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
  <p class="text-sm text-on-surface-variant font-mono mb-12">Last updated: September 15, 2026</p>

  <section class="prose prose-invert max-w-none space-y-8">
    <div>
      <h2 class="font-heading text-xl font-bold text-on-surface m-0 mb-3">Data Collected</h2>
      <p class="text-sm/relaxed text-on-surface-variant m-0">
        Site usage is monitored with Datadog Real User Monitoring, hosted in the EU (<code>datadoghq.eu</code>). It
        collects page views, resource load times, errors, performance metrics, and clicks. About 1 in 5 visits is
        recorded as a session replay; text you type into any field is masked in those replays. The chat backend also
        sends server-side traces and logs (how requests are handled, where they fail) to the same Datadog EU account.
      </p>
      <p class="text-sm/relaxed text-on-surface-variant m-0">
        This telemetry exists to keep the site fast and to debug failures. It is not used for advertising and is not
        shared with third parties beyond Datadog's processing under the EU data residency terms.
      </p>
      <p class="text-sm/relaxed text-on-surface-variant m-0">
        If you chat with the AI assistant, the conversation is stored in the site's own database so it can be resumed
        and improved. Feedback (up/down votes) on answers is stored with the message it refers to. Contact-form
        submissions are stored so they can be answered.
      </p>
      <p class="text-sm/relaxed text-on-surface-variant m-0">
        A small number of preferences (such as your sound and chat-sidebar preferences, an anonymous chat identifier,
        and whether the chat prompt has been dismissed) are stored in your browser's localStorage so the site can
        remember your choices between visits.
      </p>
      <p class="text-sm/relaxed text-on-surface-variant m-0">
        Images displayed on this site are hosted on <code>u.macula.link</code>, a media asset server (Macula DAM).
      </p>

    </div>

    <div>
      <h2 class="font-heading text-xl font-bold text-on-surface m-0 mb-3">Cookies</h2>
      <p class="text-sm/relaxed text-on-surface-variant m-0">
        Datadog's SDK sets a single functional cookie (<code>_dd_s</code>) to keep a browsing session together across
        page loads. No analytics or advertising cookies are set. Everything else stays in your browser's localStorage
        and never leaves your device.
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
