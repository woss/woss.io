<script lang="ts">
  import { page } from '$app/state';
  import Seo from '$lib/components/Seo.svelte';
</script>

<Seo
  title="Privacy Policy — woss.io"
  description="Privacy policy for woss.io — what data we collect, why, and how to manage your preferences."
  url={`${page.url.origin}/privacy`}
/>

<div class="mx-auto max-w-3xl px-6 py-16">
  <h1 class="font-heading text-4xl font-bold text-on-surface tracking-[-0.03em] m-0 mb-2">Privacy Policy</h1>
  <p class="text-sm text-on-surface-variant font-mono mb-12">Last updated: June 22, 2026</p>

  <section class="prose prose-invert max-w-none space-y-8">
    <div>
      <h2 class="font-heading text-xl font-bold text-on-surface m-0 mb-3">Data We Collect</h2>
      <p class="text-sm text-on-surface-variant leading-relaxed m-0">
        woss.io uses <strong>Datadog Real User Monitoring (RUM)</strong> to monitor site performance,
        track page views, user interactions, and JavaScript errors. This includes:
      </p>
      <ul class="text-sm text-on-surface-variant leading-relaxed pl-5 space-y-1">
        <li>Page URL and browser title</li>
        <li>Screen resolution and viewport size</li>
        <li>Click and scroll interactions</li>
        <li>Network requests (URLs, timing, status codes)</li>
        <li>JavaScript errors and stack traces</li>
        <li>Session recordings (anonymized, <code>mask-user-input</code> privacy level)</li>
      </ul>
    </div>

    <div>
      <h2 class="font-heading text-xl font-bold text-on-surface m-0 mb-3">Cookies</h2>
      <p class="text-sm text-on-surface-variant leading-relaxed m-0">
        Datadog RUM sets first-party cookies to track user sessions. These cookies are
        used solely for performance monitoring and are not used for advertising or
        cross-site tracking.
      </p>
      <p class="text-sm text-on-surface-variant leading-relaxed m-0">
        No other third-party cookies are set by this site.
      </p>
    </div>

    <div>
      <h2 class="font-heading text-xl font-bold text-on-surface m-0 mb-3">How We Use the Data</h2>
      <p class="text-sm text-on-surface-variant leading-relaxed m-0">
        Collected data is used exclusively for:
      </p>
      <ul class="text-sm text-on-surface-variant leading-relaxed pl-5 space-y-1">
        <li>Diagnosing performance issues and errors</li>
        <li>Improving user experience</li>
        <li>Monitoring site availability</li>
      </ul>
    </div>

    <div>
      <h2 class="font-heading text-xl font-bold text-on-surface m-0 mb-3">Data Storage &amp; Processing</h2>
      <p class="text-sm text-on-surface-variant leading-relaxed m-0">
        Data is transmitted to and stored on Datadog's servers in the EU region
        (<code>datadoghq.eu</code>). Datadog is the data processor;
        woss.io is the data controller. Data is encrypted in transit and at rest.
      </p>
    </div>

    <div>
      <h2 class="font-heading text-xl font-bold text-on-surface m-0 mb-3">Your Rights</h2>
      <p class="text-sm text-on-surface-variant leading-relaxed m-0">
        Under GDPR, you have the right to:
      </p>
      <ul class="text-sm text-on-surface-variant leading-relaxed pl-5 space-y-1">
        <li>Withdraw consent at any time — use the cookie banner or clear your tracking preference</li>
        <li>Request access to your personal data</li>
        <li>Request deletion of your data</li>
        <li>Object to processing</li>
      </ul>
      <p class="text-sm text-on-surface-variant leading-relaxed m-0">
        To exercise these rights, contact <a href="mailto:woss@woss.io" class="text-secondary underline hover:text-primary">woss@woss.io</a>.
      </p>
    </div>

    <div>
      <h2 class="font-heading text-xl font-bold text-on-surface m-0 mb-3">Managing Your Consent</h2>
      <p class="text-sm text-on-surface-variant leading-relaxed m-0">
        You can withdraw or change your tracking consent at any time by clearing your
        browser's local storage for this site. This will cause the cookie consent banner
        to reappear on your next visit, allowing you to make a new choice.
      </p>
    </div>

    <div>
      <h2 class="font-heading text-xl font-bold text-on-surface m-0 mb-3">Server-Side Logging</h2>
      <p class="text-sm text-on-surface-variant leading-relaxed m-0">
        In addition to client-side monitoring, woss.io sends server-side application logs
        and OpenTelemetry traces to Datadog for operational monitoring. These are
        server-to-server transmissions and do not set cookies in your browser. This
        processing is based on legitimate interest for system operations.
      </p>
    </div>

    <div>
      <h2 class="font-heading text-xl font-bold text-on-surface m-0 mb-3">Contact</h2>
      <p class="text-sm text-on-surface-variant leading-relaxed m-0">
        For privacy-related inquiries: <a href="mailto:woss@woss.io" class="text-secondary underline hover:text-primary">woss@woss.io</a>
      </p>
    </div>
  </section>
</div>
