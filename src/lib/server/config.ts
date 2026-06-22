/**
 * Server-only application config.
 * Central source of truth for all environment variables and constants.
 * All server modules should import from here, not from $env/static/* directly.
 *
 * Uses a lazy singleton for testability. Before first call to config(),
 * tests can override values by importing the variable from $env/static/private
 * or setting it in process.env.
 */

import { parseMcpServers, type McpServerConfig } from './mcp/config.ts';
import { env } from '$env/dynamic/private';
type DeepReadonly<T> = { readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K] };

type Config = DeepReadonly<{
  maculaNickname: string;
  app: { origin: string };
  openai: {
    apiKey: string;
    baseUrl: string;
    model: string;
    maxTokens: number | undefined;
    maxResultsLength: number;
    firstRoundMaxSteps: number;
    toolClassifyTimeoutMs: number;
    toolClassifyModel: string | undefined;
    relevanceCheckModel: string | undefined;
    maxRounds: number;
  };
  mcp: { servers: McpServerConfig[] };
  llmCache: { enabled: boolean; ttlSec: number };
  report: { webhookUrl: string; webhookToken: string; errorWebhookUrl: string };
}>;

const {
  ORIGIN,
  PROVIDER_API_KEY,
  LLM_PROVIDER_BASE_URL,
  MAIN_MODEL,
  MAX_TOKENS,
  FIRST_ROUND_MAX_STEPS,
  MAX_ROUNDS,
  MCP_SERVERS,
  LLM_CACHE_ENABLED,
  LLM_CACHE_TTL,
  WOSS_USER_WEBHOOK_URL,
  WOSS_USER_WEBHOOK_TOKEN,
  WOSS_USER_WEBHOOK_ERROR_URL,
  TOOL_CLASSIFY_TIMEOUT_MS,
  TOOL_CLASSIFY_MODEL,
  RELEVANCE_CHECK_MODEL,
  MAX_RESULTS_LENGTH,
} = env;

let _config: Config | null = null;

function loadConfig(): Config {
  const mcpServers = parseMcpServers(MCP_SERVERS);

  const c = {
    maculaNickname: 'woss',
    app: {
      /** Allowed origin for CORS/CSRF checks */
      origin: ORIGIN ?? 'http://localhost:5173',
    },
    openai: {
      apiKey: PROVIDER_API_KEY ?? 'public',
      baseUrl: (LLM_PROVIDER_BASE_URL ?? 'http://localhost:1234/v1').replace(/\/+$/, ''),
      model: MAIN_MODEL ?? 'mistralai/ministral-3-3b',
      maxTokens: Number(MAX_TOKENS) > 0 ? Number(MAX_TOKENS) : 10000,
      firstRoundMaxSteps: Number(FIRST_ROUND_MAX_STEPS) > 0 ? Number(FIRST_ROUND_MAX_STEPS) : 5,
      maxRounds: Number(MAX_ROUNDS) > 0 ? Number(MAX_ROUNDS) : 3,
      maxResultsLength: Number(MAX_RESULTS_LENGTH) > 0 ? Number(MAX_RESULTS_LENGTH) : 64000,
      toolClassifyTimeoutMs: Number(TOOL_CLASSIFY_TIMEOUT_MS) > 0 ? Number(TOOL_CLASSIFY_TIMEOUT_MS) : 15000,
      toolClassifyModel: TOOL_CLASSIFY_MODEL || undefined,
      relevanceCheckModel: RELEVANCE_CHECK_MODEL || undefined,
    },
    mcp: {
      servers: mcpServers,
    },
    llmCache: {
      enabled: LLM_CACHE_ENABLED === 'true' || LLM_CACHE_ENABLED === '1',
      ttlSec: Number(LLM_CACHE_TTL) > 0 ? Number(LLM_CACHE_TTL) : 86400,
    },
    report: {
      webhookUrl: WOSS_USER_WEBHOOK_URL ?? '',
      webhookToken: WOSS_USER_WEBHOOK_TOKEN ?? '',
      errorWebhookUrl: WOSS_USER_WEBHOOK_ERROR_URL ?? '',
    },
  } as Config;

  return c;
}

/**
 * Get the server config singleton.
 * Lazily initialized on first access.
 */
export function config(): Config {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}
