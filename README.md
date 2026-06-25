# woss.io

This is my AI-native portfolio. It's a SvelteKit app that knows everything about me and talks to you about it. Drop a question into the chat and it searches my blog posts, resume, and project docs before answering. It can also call real tools: browse my GitHub repos, check pull requests, pull photography from my Macula site.

Everything runs locally: embeddings, vector search, LLM calls. No external AI services beyond whatever model endpoint you point it at.

## What it does

The core idea is pretty simple: a chat interface on top of everything I've built and written. When you ask something, the app chunks up my content into vectors, matches what you're asking against the index, then feeds the relevant bits to an LLM along with the tools it can call. You get answers backed by real content, not hallucination.

The LLM cache is worth calling out specifically. It's a USearch ANN index that checks if someone already asked something similar before hitting the API. Same question gets an instant cached response. Close question gets a partial match. Configurable threshold so you can tune how aggressive the dedup is.

Beyond the chat, there's:

- **Blog and resume**: markdown files with frontmatter, full-text and vector searchable
- **OG images**: rendered server-side per post with Satori and resvg-js, no external service
- **Dark and light mode**: follows your system preference, handled by mode-watcher
- **Rate limiting**: SQLite-backed, 10 requests per minute per IP
- **GeoIP**: country detection via geoip-country so I know roughly where visitors are
- **Structured logging**: LogTape with file rotation plus a ZinaLog dashboard for browsing
- **Webhooks**: events pushed to external URLs when interesting things happen
- **Message reactions**: upvote, downvote, or heart AI responses
- **Contact and intent detection**: the AI can figure out if you're trying to hire me or just browsing
- **Docker**: multi-stage build, production ready

## Getting started

```bash
pnpm install
cp example.env .env
# Edit .env: set PROVIDER_API_KEY, LLM_PROVIDER_BASE_URL, OPENAI_MODEL
pnpm run dev
```

Optionally build the search index for RAG:

```bash
pnpm run build-index
```

Open http://localhost:5173.

You'll need Node.js 26.x (see devEngines) and an OpenAI-compatible LLM endpoint. LM Studio, Ollama, or vLLM for local. Any cloud provider works too. Docker is optional but recommended for deployment.

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
| `GITHUB_TOKEN`                 | -                          | GitHub PAT for MCP server          |
| `LLM_CACHE_ENABLED`            | `true`                     | Enable semantic LLM response cache |
| `PUBLIC_WOSS_MAX_MESSAGES`     | `50`                       | Max messages per chat              |
| `PUBLIC_WOSS_MAX_CHATS`        | `100`                      | Max chats per visitor              |
| `WOSS_USER_WEBHOOK_URL`        | -                          | Webhook URL for events             |
| `WOSS_USER_WEBHOOK_ERROR_URL`  | -                          | Webhook URL for errors             |
| `WOSS_USER_WEBHOOK_TOKEN`      | -                          | Webhook auth token                 |
| `ZINALOG_ENCRYPTION_KEY`       | -                          | Encryption key for ZinaLog         |

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

## Customizing content

Content lives in markdown files. Here's where everything is:

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

Implemented via custom rehype plugin (`src/lib/server/rehype-admonitions.ts`) with no extra dependencies.

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

- **Gemma 4** (gemma-4-e4b-it): uses native `<|tool_call|>` tokens instead of OpenAI JSON schema. Causes tool-calling failures.

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

- **app**: Main SvelteKit app (port 5173 → 3000)
- **search-index-init**: One-shot search index builder
- **zinalog**: Log aggregation dashboard (port 4000)

## Stack

The tech side in one shot:

- **Framework**: SvelteKit 2, Svelte 5 (runes)
- **Styling**: Tailwind CSS v4, Tailwind Typography, Bits-UI
- **Runtime**: Node.js 26, pnpm
- **Database**: SQLite (better-sqlite3)
- **Vector Index**: USearch (ANN)
- **AI SDK**: Vercel AI SDK (streamText, tool calling)
- **Embeddings**: HuggingFace Transformers.js (ONNX), in-process, no external API
- **MCP Client**: @modelcontextprotocol/sdk
- **OG Images**: Satori + resvg-js
- **Logging**: LogTape + ZinaLog
- **CI/CD**: GitHub Actions → Docker → VPS

## License

Private. All rights reserved.
