# Installation

## Prerequisites

- Node.js 26.x
- pnpm
- OpenAI-compatible LLM endpoint (LM Studio, Ollama, vLLM, or any cloud provider)

## Setup

```bash
pnpm install
cp example.env .env
# Edit .env: set PROVIDER_API_KEY, LLM_PROVIDER_BASE_URL, MAIN_MODEL
pnpm run dev
```

Open <http://localhost:5173>.

### Build the search index

```bash
pnpm run build-index
```

Required for RAG responses. Without it, the chat still works but won't search blog posts or resume content.

## Docker

```bash
docker compose up --build -d
```

Or build manually:

```bash
docker build -t woss/woss-io .
docker run -p 3000:3000 --env-file .env -v ./data:/app/data woss/woss-io
```

### Docker Compose stacks

| Service   | Purpose                       | Port        |
| --------- | ----------------------------- | ----------- |
| `woss`    | Main SvelteKit app            | 5173 → 3000 |
| `init`    | One-shot search index builder | —           |
| `zinalog` | Log aggregation dashboard     | 4000        |

## SurrealDB (Development — Migration Target)

SurrealDB is the migration target to replace SQLite + USearch. The dev server runs at `ws://localhost:10101` with user `admin` / password `admin`, namespace `woss`, database `woss`.

Spin up via Docker:

```bash
docker run -p 8000:8000 surrealdb/surrealdb start --log trace --user root --pass root
```

Or use the surreal binary:

```bash
surreal start --log trace --user root --pass root
```

Environment variables are in `.env` — see `SURREAL_DB_*` vars.

## Environment variables

Key variables (full list in README.md):

| Variable                | Default                    | Description                  |
| ----------------------- | -------------------------- | ---------------------------- |
| `PROVIDER_API_KEY`      | `public`                   | LLM endpoint API key         |
| `LLM_PROVIDER_BASE_URL` | `http://localhost:1234/v1` | OpenAI-compatible base URL   |
| `MAIN_MODEL`            | `mistralai/ministral-3-3b` | Model ID                     |
| `PUBLIC_MAX_CHATS`      | `3`                        | Max chats per visitor        |
| `PUBLIC_MAX_MESSAGES`   | `10`                       | Max messages per chat        |
| `SURREAL_DB_URL`        | `ws://localhost:10101`     | SurrealDB WebSocket endpoint |
