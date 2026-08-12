import { datadogRum } from '@datadog/browser-rum';
import { datadogLogs } from '@datadog/browser-logs';
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
 * Idempotent: guards on each SDK's init configuration before initialization.
 */
export function initDatadogRum(): void {
  const rumInitialized = datadogRum.getInitConfiguration();
  const logsInitialized = datadogLogs.getInitConfiguration();
  if (rumInitialized && logsInitialized) return;

  // Env reads at call time only, so SSR/client hydration both see current values.
  const appId = env.PUBLIC_DD_RUM_APP_ID;
  const clientToken = env.PUBLIC_DD_RUM_CLIENT_TOKEN;

  if (!appId || !clientToken) return;

  const version = `1.1.0-${dev ? 'dev' : 'prod'}`;
  if (!logsInitialized) {
    datadogLogs.init({
      clientToken,
      site: 'datadoghq.eu',
      forwardErrorsToLogs: true,
      forwardConsoleLogs: ['error', 'warn'],
      sessionSampleRate: 100,
      service: SERVICE_NAME_FALLBACK,
      env: dev ? 'dev' : 'production',
      version,
    });
  }

  if (rumInitialized) return;

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
