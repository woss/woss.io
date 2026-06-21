# woss.io

AI-native personal portfolio built with **SvelteKit 2 + Svelte 5 (runes) + Tailwind CSS v4**.

Turn your resume into an interactive AI assistant that knows everything about you.

## Features

- **AI Chat Assistant** — Portfolio-aware LLM chatbot. Asks questions about your skills, experience, and projects. Uses RAG (Retrieval-Augmented Generation) over your content.
- **MCP Tool Calling** — AI can call real tools: browse GitHub repos, check PRs, search issues, pull photography from Macula. Configurable per deployment.
- **Semantic LLM Cache** — USearch ANN index caches similar responses. Reduces API calls. Configurable threshold.
- **Local Embeddings** — HuggingFace Transformers.js (ONNX) for in-process text embeddings. No external embedding API.
- **RAG Pipeline** — Content chunked, embedded (bge-large-en-v1.5), stored in USearch vector index. Queries matched semantically before LLM generation.
- **Blog + Resume** — Markdown-backed content with vector search. Tags, excerpts, series linking.
- **Dynamic OG Images** — Satori + resvg-js generates Open Graph images server-side per post. No external service.
- **Mermaid Diagrams** — Sidecar service (Deno + Lightpanda) renders Mermaid to SVG in blog posts.
- **Real-time Streaming** — Server-Sent Events for live AI response streaming.
- **Dark/Light mode** — mode-watcher with system preference detection.
- **Rate Limiting** — SQLite-backed IP-based (10 req/min).
- **GeoIP** — Country detection via geoip-country.
- **Structured Logging** — LogTape with file rotation + ZinaLog dashboard.
- **Webhook Notifications** — Events pushed to external webhooks.
- **Message Reactions** — Visitors can upvote/downvote/heart AI responses.
- **Contact + Intent Detection** — AI detects hiring/contact intent alongside contact form.
- **Dockerized** — Multi-stage build, production-ready.

## Prerequisites

- **Node.js 25.x** (defined in `devEngines`)
- **pnpm** — package manager
- **OpenAI-compatible LLM endpoint** — local (LM Studio, Ollama, vLLM) or cloud

Optional:

- **Docker** — for containerized deployment
- **Mermaid sidecar** — for diagram rendering in blog posts

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp example.env .env
# Edit .env: set PROVIDER_API_KEY, LLM_PROVIDER_BASE_URL, OPENAI_MODEL

# 3. Start dev server
pnpm run dev

# 4. (Optional) Build search index for RAG
pnpm run build-index
```

Open <http://localhost:5173>.

## Configuration

| Variable                       | Default                    | Description                        |
| ------------------------------ | -------------------------- | ---------------------------------- |
| `ORIGIN`                       | `http://localhost:5173`    | App origin for CORS/redirects      |
| `PROVIDER_API_KEY`             | `public`                   | API key for your LLM endpoint      |
| `LLM_PROVIDER_BASE_URL`        | `http://localhost:1234/v1` | OpenAI-compatible API base URL     |
| `OPENAI_MODEL`                 | `mistralai/ministral-3-3b` | Model ID to use                    |
| `OPENAI_MAX_TOKENS`            | `10000`                    | Max output tokens                  |
| `OPENAI_FIRST_ROUND_MAX_STEPS` | `10`                       | Max tool steps in first round      |
| `OPENAI_TOOL_CLASSIFY_TIMEOUT` | `15000`                    | Tool classification timeout (ms)   |
| `OPENAI_MAX_ROUNDS`            | `3`                        | Max tool-calling rounds            |
| `MCP_SERVERS`                  | `[]`                       | JSON array of MCP server configs   |
| `GITHUB_TOKEN`                 | —                          | GitHub PAT for MCP server          |
| `LLM_CACHE_ENABLED`            | `true`                     | Enable semantic LLM response cache |
| `PUBLIC_WOSS_MAX_MESSAGES`     | `50`                       | Max messages per chat              |
| `PUBLIC_WOSS_MAX_CHATS`        | `100`                      | Max chats per visitor              |
| `WOSS_USER_WEBHOOK_URL`        | —                          | Webhook URL for events             |
| `WOSS_USER_WEBHOOK_ERROR_URL`  | —                          | Webhook URL for errors             |
| `WOSS_USER_WEBHOOK_TOKEN`      | —                          | Webhook auth token                 |
| `MERMAID_API_KEY`              | —                          | API key for Mermaid sidecar        |
| `MERMAID_RENDER_BASE_URL`      | `http://localhost:8121`    | Mermaid sidecar URL                |
| `ZINALOG_ENCRYPTION_KEY`       | —                          | Encryption key for ZinaLog         |

### MCP Server Configuration

`MCP_SERVERS` is a JSON array with `$VAR` substitution support:

```json
[
  {
    "id": "github",
    "label": "GitHub",
    "url": "https://mcp.github.com/api",
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

## Customizing Content

| What           | Where                                | Format                                                |
| -------------- | ------------------------------------ | ----------------------------------------------------- |
| Blog posts     | `src/content/posts/*.md`             | Markdown + frontmatter (title, date, tags, excerpt)   |
| Resume entries | `src/content/experience/*.md`        | Markdown + frontmatter (company, role, dates, skills) |
| Site config    | `src/lib/config.ts`                  | TypeScript (Macula nickname, defaults)                |
| Domain         | `CNAME`                              | Single line: `yourdomain.com`                         |
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

Implemented via custom rehype plugin (`src/lib/server/rehype-admonitions.ts`) — no extra dependencies.

## Supported LLMs

The AI backend expects OpenAI-compatible JSON tool calling format. Compatible local models:

| Model Family                | Sizes             | Notes                      |
| --------------------------- | ----------------- | -------------------------- |
| Qwen 2.5                    | 7B, 14B, 32B, 72B | Best tool calling per size |
| Llama 3.1 / 3.3             | 8B, 70B, 405B     | Wide support               |
| Mistral Nemo / Small 3.1    | 12B, 24B          | Good quality               |
| DeepSeek-v2 / v3 / v4-flash | any               | Native tool calling        |
| Phi-4 / Phi-4-mini          | 14B, 3.8B         | Lightweight                |
| Command R / R+              | 7B, 35B           | Built-in tool use          |
| Hermes 3                    | 8B, 70B, 405B     | Purpose-built for tool use |
| QwQ-32B                     | 32B               | Reasoning + tools          |

### Incompatible Models

- **Gemma 4** (gemma-4-e4b-it) — uses native `<|tool_call|>` tokens instead of OpenAI JSON schema. Causes tool-calling failures.

All models must be served via an OpenAI-compatible API (LM Studio, Ollama, vLLM) at the configured endpoint.

## Docker

```bash
# Build and run
docker compose up --build -d

# Or build manually
docker build -t woss/woss-io .
docker run -p 3000:3000 --env-file .env -v ./data:/app/data woss/woss-io
```

Docker Compose stacks:

- **app** — Main SvelteKit app (port 5173 → 3000)
- **search-index-init** — One-shot search index builder
- **zinalog** — Log aggregation dashboard (port 4000)
- **ollama** (commented) — Local LLM server sidecar
- **mermaid** (commented) — Diagram rendering sidecar

## Stack

- **Framework**: SvelteKit 2, Svelte 5 (runes)
- **Styling**: Tailwind CSS v4, Tailwind Typography, Bits-UI
- **Runtime**: Node.js 25, pnpm
- **Database**: SQLite (better-sqlite3)
- **Vector Index**: USearch (ANN)
- **AI SDK**: Vercel AI SDK (streamText, tool calling)
- **Embeddings**: HuggingFace Transformers.js (ONNX)
- **MCP Client**: @modelcontextprotocol/sdk
- **OG Images**: Satori + resvg-js
- **Logging**: LogTape + ZinaLog
- **CI/CD**: GitHub Actions → Docker → VPS

## License

Private. All rights reserved.
