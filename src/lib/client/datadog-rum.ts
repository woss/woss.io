import { datadogRum } from '@datadog/browser-rum';
import { env } from '$env/dynamic/public';
import { dev } from '$app/environment';
import { SERVICE_NAME_FALLBACK } from '../../dd-config';

/**
 * Initializes Datadog RUM on the client.
 *
 * Client-only module: the SDK reads `window`/`document`, so this module must
 * never be imported from a server or universal module. `$env/dynamic/public`
 * is the only env module usable here — `$env/dynamic/private` throws when
 * accessed in the browser.
 *
 * Idempotent: guards on `getInitConfiguration()` before any env reads or SDK
 * calls so a second `init()` — which would emit
 * `console.error("DD_RUM is already initialized")` in
 * `@datadog/browser-rum@7.7.0` — can never happen.
 */
export function initDatadogRum(): void {
  // Idempotency guard FIRST — prevents the v7.7.0 double-init console.error.
  if (datadogRum.getInitConfiguration()) return;

  // Env reads at call time only, so SSR/client hydration both see current values.
  const appId = env.PUBLIC_DD_RUM_APP_ID;
  const clientToken = env.PUBLIC_DD_RUM_CLIENT_TOKEN;

  // Silent skip: no SDK call, no error, no console output when unset.
  if (!appId || !clientToken) {
    console.log(`Datadog RUM not initialized: PUBLIC_DD_RUM_APP_ID or PUBLIC_DD_RUM_CLIENT_TOKEN is unset`);
    return;
  }

  // service/env mirror the .env values DD_SERVICE=woss-io and DD_ENV=dev.
  // Those vars are NOT PUBLIC_-prefixed and thus not readable via
  // $env/dynamic/public, so they are inlined as constants matching the .env file.
  datadogRum.init({
    applicationId: appId,
    clientToken: clientToken,
    site: 'datadoghq.eu',
    sessionSampleRate: 100,
    sessionReplaySampleRate: 20,
    trackResources: true,
    trackLongTasks: true,
    trackUserInteractions: true,
    traceContextInjection: 'all',
    allowedTracingUrls: [
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      (url: string, init?: RequestInit) => {
        try {
          return new URL(url).origin === location.origin;
        } catch {
          return false;
        }
      },
    ],
    defaultPrivacyLevel: 'mask-user-input',
    service: SERVICE_NAME_FALLBACK,
    env: dev ? 'dev' : 'production',
    version: `1.1.0-${dev ? 'dev' : 'prod'}`,
  });
  datadogRum.onReady(() => {
    console.log('Datadog RUM initialized');
  });
}
