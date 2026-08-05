# woss.io

This is my AI-native portfolio. It's a SvelteKit app that knows everything about me and talks to you about it. Drop a question into the chat and it searches my blog posts, resume, and project docs before answering. It can also call real tools: browse my GitHub repos, check pull requests, pull photography from my Macula site.

Everything runs locally: embeddings, vector search, LLM calls. No external AI services beyond whatever model endpoint you point it at.

## What it does

The core idea is pretty simple: a chat interface on top of everything I've built and written. When you ask something, the app chunks up my content into vectors, matches what you're asking against the index, then feeds the relevant bits to an LLM along with the tools it can call. You get answers backed by real content, not hallucination.

The LLM cache is worth calling out specifically. It's a USearch ANN index that checks if someone already asked something similar before hitting the API. Same question gets an instant cached response. Close question gets a partial match. Configurable threshold so you can tune how aggressive the dedup is.

Beyond the chat, there's:

- **Blog and resume**: markdown files with frontmatter, full-text and vector searchable
- **OG images**: rendered server-side per post with Satori and resvg-js, no external service
- **Dark and light mode**: follows your system preference, handled by sv5ui theming
- **Rate limiting**: SQLite-backed, 10 requests per minute per IP
- **GeoIP**: country detection via geoip-country so I know roughly where visitors are
- **Structured logging**: LogTape with file rotation plus a ZinaLog dashboard for browsing
- **Webhooks**: events pushed to external URLs when interesting things happen
- **Message reactions**: upvote, downvote, or heart AI responses
- **Reasoning display**: collapsible "thinking" accordion showing model chain-of-thought with character count badge
- **Contact and intent detection**: the AI can figure out if you're trying to hire me or just browsing
- **Docker**: multi-stage build, production ready

## Getting started

```bash
pnpm install
cp example.env .env
# Edit .env: set PROVIDER_API_KEY, LLM_PROVIDER_BASE_URL, MAIN_MODEL
pnpm run dev
```

Optionally build the search index for RAG:

```bash
pnpm run build-index
```

Open <http://localhost:5173>.

You'll need Node.js 26.x (see devEngines) and an OpenAI-compatible LLM endpoint. LM Studio, Ollama, or vLLM for local. Any cloud provider works too. Docker is optional but recommended for deployment.

### Turbo commands

Builds and tests are cached via Turborepo. Tasks are defined in `turbo.jsonc` with an explicit DAG:

| Task          | Depends on | Outputs                      | Inputs (cache key)                                                              |
| ------------- | ---------- | ---------------------------- | ------------------------------------------------------------------------------- |
| `build`       | `^build`   | `build/**`, `.svelte-kit/**` | `src/**`, `svelte.config.js`, `vite.config.ts`, `tsconfig.json`, `package.json` |
| `test`        | `build`    | `coverage/**`                | (inherits from build inputs)                                                    |
| `lint`        | —          | `tmp/**`                     | `src/**`                                                                        |
| `check`       | —          | —                            | —                                                                               |
| `build-index` | —          | —                            | —                                                                               |
| `fmt:check`   | —          | —                            | —                                                                               |

Run individual tasks or let turbo handle the dependency graph:

```bash
# Build (cached, respects topological order)
pnpm turbo build

# Lint + build + test in parallel (respects task graph — test waits for build)
pnpm turbo build lint test

# Full CI pipeline
pnpm turbo build lint test && pnpm check
```

Remote caching is enabled — turbo can share cache across CI runs and local builds. Cache keys hash inputs (`src/**`, config files, `package.json`) so stale entries invalidate automatically.

## Configuration

| Variable                      | Default                    | Description                            |
| ----------------------------- | -------------------------- | -------------------------------------- |
| `ORIGIN`                      | `http://localhost:5173`    | App origin for CORS/redirects          |
| `PROVIDER_API_KEY`            | `public`                   | API key for your LLM endpoint          |
| `LLM_PROVIDER_BASE_URL`       | `http://localhost:1234/v1` | OpenAI-compatible API base URL         |
| `MAIN_MODEL`                  | `mistralai/ministral-3-3b` | Model ID to use                        |
| `MAX_TOKENS`                  | `10000`                    | Max output tokens                      |
| `FIRST_ROUND_MAX_STEPS`       | `5`                        | Max tool steps in first round          |
| `TOOL_CLASSIFY_TIMEOUT_MS`    | `15000`                    | Tool classification timeout (ms)       |
| `TOOL_CLASSIFY_MODEL`         | -                          | Model for tool classification          |
| `RELEVANCE_CHECK_MODEL`       | -                          | Model for relevance scoring            |
| `MAX_ROUNDS`                  | `3`                        | Max tool-calling rounds                |
| `MAX_RESULTS_LENGTH`          | `64000`                    | Max content length per search result   |
| `LLM_CACHE_ENABLED`           | `true`                     | Enable semantic LLM response cache     |
| `LLM_CACHE_TTL`               | `86400`                    | Cache TTL in seconds                   |
| `MCP_SERVERS`                 | `[]`                       | JSON array of MCP server configs       |
| `GITHUB_TOKEN`                | -                          | GitHub PAT (referenced in MCP_SERVERS) |
| `PUBLIC_MAX_MESSAGES`         | `10`                       | Max messages per chat                  |
| `PUBLIC_MAX_CHATS`            | `3`                        | Max chats per visitor                  |
| `WOSS_USER_WEBHOOK_URL`       | -                          | Webhook URL for events                 |
| `WOSS_USER_WEBHOOK_ERROR_URL` | -                          | Webhook URL for errors                 |
| `WOSS_USER_WEBHOOK_TOKEN`     | -                          | Webhook auth token                     |
| `DD_API_KEY`                  | -                          | Datadog API key (APM + logs)           |
| `DD_ENV`                      | `production`               | Datadog environment tag                |
| `DD_SITE`                     | `datadoghq.eu`             | Datadog site                           |
| `DD_SERVICE`                  | `woss-io`                  | Datadog service name                   |
| `DD_VERSION`                  | -                          | Datadog version tag                    |
| `PUBLIC_DD_RUM_APP_ID`        | -                          | Datadog RUM application ID             |
| `PUBLIC_DD_RUM_CLIENT_TOKEN`  | -                          | Datadog RUM client token               |
| `PUBLIC_APP_VERSION`          | `0.0.0`                    | App version tag for Datadog            |
| `ZINALOG_ENCRYPTION_KEY`      | -                          | Encryption key for ZinaLog container   |

### MCP Endpoint

woss.io exposes its own Streamable HTTP MCP endpoint at `POST /mcp` for AI agents. The endpoint normalizes the Accept header to include both `application/json` and `text/event-stream` — required by the Streamable HTTP transport. The embedding model (~1.3GB ONNX via Transformers.js) pre-warms on first request to prevent timeout on initial search queries.

### MCP Server Configuration

`MCP_SERVERS` is a JSON array with `$VAR` substitution support:

```json
[
  {
    "id": "github",
    "label": "GitHub",
    "url": "ttps://api.githubcopilot.com/mcp/",
    "type": "remote",
    "token": "$GITHUB_TOKEN"
  },
  {
    "id": "macula",
    "label": "Macula",
    "url": "https://u.macula.link/mcp",
    "type": "remote",
    "token": "public"
  }
]
```

### Observability / Datadog APM

APM tracing runs agentless: dd-trace posts spans directly to the Datadog EU intake (`public-trace-http-intake.logs.datadoghq.eu/api/v2/spans`) with no local Datadog agent. Required in `.env`:

- `DD_API_KEY` — Datadog API key
- `DD_SITE` — Datadog site, e.g. `datadoghq.eu`
- `DD_ENV` — environment tag
- `DD_SERVICE` — service name (defaults to `woss-io`)

`DD_VERSION` is optional (version tag).

dd-trace reads `process.env`, so `src/instrumentation.server.ts` mirrors `$env/dynamic/private` into `process.env` before `tracer.init()` (via `??=`, so values already in `process.env` win). The mirror is required in dev, where SvelteKit doesn't load `.env` into `process.env`; in Docker/prod, `env_file` already populates `process.env` and the mirror is a no-op.

## Customizing content

Content lives in markdown files. Here's where everything is:

| What           | Where                                | Format                                                |
| -------------- | ------------------------------------ | ----------------------------------------------------- |
| Blog posts     | `src/content/posts/*.md`             | Markdown + frontmatter (title, date, tags, excerpt)   |
| Resume entries | `src/content/experience/*.md`        | Markdown + frontmatter (company, role, dates, skills) |
| Site config    | `src/lib/config.ts`                  | TypeScript (Macula nickname, defaults)                |
| Branding       | `static/favicon.ico`, `src/app.html` | Favicon, HTML shell                                   |
| Pages          | `src/routes/`                        | SvelteKit file-based routing                          |
| UI components  | `src/lib/components/`                | Svelte 5 components                                   |

After changing content, rebuild the search index:

```bash
pnpm run build-index
```

### Markdown Extensions

Blog posts support GitHub-style admonition callouts. Use them inside blockquotes to highlight important information:

```markdown
> [!INFO]
> Your file will be processed within 24 hours.

> [!WARNING]
> This operation cannot be undone.

> [!ERROR]
> Connection failed. Check your credentials.

> [!SUCCESS]
> Migration completed successfully.
```

Renders as color-coded callout boxes with left border accent and tinted background.

Supported types: `INFO`, `WARNING`, `ERROR`, `SUCCESS`.

Implemented via custom rehype plugin (`src/lib/server/rehype-admonitions.ts`) with no extra dependencies.

## Docker

```bash
# Build and run
docker compose up --build -d

# Or build manually
docker build -t woss/woss-io .
docker run -p 3000:3000 --env-file .env -v ./data:/app/data woss/woss-io
```

Docker Compose stacks:

- **woss**: Main SvelteKit app (port 5173 → 3000)
- **init**: One-shot search index builder
- **zinalog**: Log aggregation dashboard (port 4000)

## Stack

The tech side in one shot:

- **Framework**: SvelteKit 2, Svelte 5 (runes)
- **Styling**: Tailwind CSS v4, Tailwind Typography, sv5ui
- **Runtime**: Node.js 26, pnpm
- **Task Runner**: Turborepo v2 (DAG-based build caching)
- **Database**: SQLite (better-sqlite3) behind async DatabaseService interface
- **Vector Index**: USearch (ANN)
- **AI SDK**: Vercel AI SDK (streamText, tool calling)
- **Embeddings**: HuggingFace Transformers.js (ONNX), in-process, no external API, pre-warms on first request
- **MCP Client**: @modelcontextprotocol/sdk
- **MCP Server**: Streamable HTTP transport at POST /mcp, Accept header normalization
- **OG Images**: Satori + resvg-js
- **Logging**: LogTape + ZinaLog
- **Container**: Docker + Docker Compose

## License

AGPL-3.0-only
