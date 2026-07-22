/// <reference types="@sveltejs/kit" />

/**
 * Service Worker — Docsify Neutralizer
 *
 * Replaces the old docsify service worker cached in users' browsers that
 * intercepts requests for /pages/*, /_coverpage.md, /README.md, /assets/svg/*, etc.
 *
 * This SW does not cache anything. It immediately activates, deletes all prior
 * caches, and passes every fetch through to the network. This prevents request
 * interception conflicts between docsify and SvelteKit.
 */

import { build, files, version } from '$service-worker';

// SvelteKit tracks these imports for build dependency invalidation
void build;
void files;
void version;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sw = self as any;

sw.addEventListener('install', () => {
  sw.skipWaiting();
});

sw.addEventListener('activate', async () => {
  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));
  await sw.clients.claim();
});

sw.addEventListener('fetch', (event) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const request = (event as any).request as Request;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (event as any).respondWith(
    fetch(request).catch(
      () =>
        new Response('Offline', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain' },
        }),
    ),
  );
});
