---
published: true
title: 'Building woss.io: A Journey Into AI-Powered Personal Portfolios'
slug: 'building-woss-io'
featured: true
description: 'How I rebuilt woss.io from the ground up — an AI-native personal portfolio with streaming LLM chat, local vector embeddings, MCP tool integrations, and a modern SvelteKit 2 stack.'
date: 2026-06-21
tags:
  - SvelteKit
  - AI
  - RAG
  - vector search
  - MCP
  - SQLite
  - portfolio
header_image: '[Space whale](https://u.macula.link/Z1TIROJeSMmFYnmvlCOPLg-7)'
---

The old woss.io was static. A simple portfolio page, blog posts rendered from markdown, a contact form. It worked, but it didn't reflect how I actually work — with AI tools daily, building systems that reason, search, and generate. Earlier this year a friend of mine asked me about my CV and I sent him my woss.io link. He replied with this message: "when did you last update this? Early 2000?". I laughed and thought, "Yeah, it's time for a rebuild." But I didn't want a static site.

I wanted a site that could talk back, interact, and adapt. Not a chatbot bolted on as a gimmick, but a site where AI is the primary interface — visitors ask questions, the AI searches my career history, reads my blog posts, explores my GitHub projects and Macula photo portfolio, and answers in real-time.

This is the story of building that.

## The Stack

- SvelteKit 2 + Svelte 5 (Runes)
- Tailwind CSS v4 + [SV5UI](https://sv5ui.vercel.app/)
- TypeScript
- SQLite (better-sqlite3)
- USearch (vector index)
- Vercel AI SDK + Effect.ts
- Transformers.js (local ONNX embeddings)
- MCP (Model Context Protocol)
- SSE streaming for real-time token display
- Centroid-based query classification + LLM fallback

Every choice was deliberate.

**SvelteKit 2** over Next.js. I've worked with both. One of them left me reading docs for things React hooks should've just warned me about. SvelteKit's file-based routing is simpler, the Runes reactivity model (Svelte 5's `$state`, `$derived`, `$effect`, `$snippets`) is more explicit than React hooks without the mental overhead of dependency arrays. The `adapter-node` deployment model — build, copy, run — fits a single-server SQLite setup perfectly.

**Tailwind CSS v4** with the `@theme` directive for design tokens. v4 drops the config file entirely — everything lives in a single `app.css` with `@theme {}` blocks. Font stack, border radii, shadows, animations — all defined once, used everywhere. The `@tailwindcss/typography` plugin handles blog prose rendering with zero custom CSS for markdown content. And with **SV5UI**, I get a full component library with small JS footprint, reduces the need for common components like buttons, modals, and tabs.

**SQLite** because a personal site doesn't need Postgres. `better-sqlite3` is synchronous, fast, and trivially portable. The entire database is one file (`data/woss.db`). Backups are `cp`. Try that with your RDS cluster.

**USearch** for vector search. 1024-dimensional embeddings, Cosine similarity, BF16 quantization. Fast enough for real-time RAG on a single server. No external vector database to manage.

**Transformers.js** for local embeddings. The BGE model runs in-process via ONNX. No external embedding API, no network calls, no API keys. Model loads ~1.3GB on boot, then stays cached. Batch inference for indexing, single-pass for queries.

**Centroid classification** for query routing. Pre-compute centroids for RAG, tool, and hybrid question types. Embed the query, compare against centroids, route to the right path. Tool-only questions skip RAG entirely. Hybrid questions do both.

## The Journey: Four Phases

This wasn't a straight build. It was four distinct phases, each revealing new constraints that forced the architecture to evolve.

### Phase 1: The Idea and Research

I wanted a site that could answer questions about me — my career, my projects, my photography. I wanted it to be interactive, not static. I wanted it to be AI-native, not a chatbot bolted on as a gimmick.
Also I didn't want to spend thousands of euros on cloud services and LLM API calls. I wanted it to run on a cheap VPS with SQLite, local embeddings, and call LLM APIs only when necessary.
I wanted it to be fast, responsive, and cost-effective. At this stage I decided on half of the stack, one that I know well. Decision was easy, latest Sveltekit (never regretted ditching React and other libraries for this framework), Tailwind CSS, SQLite, and a local embedding model.
The other half was more experimental: Vercel AI SDK, Effect.ts, USearch, and MCP. I had to learn a lot, and still I don't fully understand some things I have in the code. Most of these are around centroids, which are written by deepseek-v4 😊.

The next step was to rewrite old experience as detailed as I could remember, which was quite a challenge, who can really remember what they did for a company over 16 years ago? But as my father says "Take a beer my boy, things will come back to you". And they did, I rewrote all my experience in few hours and four beers.

Now I had a solid ground to start building. I had a clear vision of what I wanted to achieve, and the tools to make it happen. The next step was to follow the tutorials and get a working prototype.

### Phase 2: Following the Tutorials

Every project starts with docs. I followed the Vercel AI SDK tutorials, got a streaming chat working with DeepSeek in an afternoon. The model called tools, returned answers, everything worked beautifully — inside the tutorial sandbox.

The docs show a clean flow: question → tool call → answer. No edge cases, no format drift, no infinite loops. It was almost too easy. I remember thinking: this is dangerously easy, it can't be. That's usually when the architecture starts lying to you.

I started with one MCP server — just GitHub. The LLM could search repos, read issues, check pull requests. One server, one toolkit, simple life.

Then I got greedy. Macula had my entire photo portfolio — couldn't the AI browse that too? I wrote actual Macula MCP entirely from scratch, I learned something, one thing is to write an MCP and completely another is to have LLM use it.

Plugged it in. The Macula MCP was designed like a REST API — 14 specialized tools, one per operation. `search_files`, `get_user_profile`, `list_keywords`, `get_random_files`. For weeks I fought it — writing more prompts, adding more instructions, trying to teach the LLM which tool to call when. It kept guessing wrong. It hallucinated directory contents — fabricating filenames instead of navigating to them.

The breakthrough didn't come from more instructions. It came from stepping back with a beer and a question: how does an LLM naturally understand pathways to information?

Entity → Relationship → Entity, a classic Semantic Triple!!. The model thinks in associations, not endpoints. Macula data was already a graph — files connect to users through uploads, to keywords through tags, to directories through containment — but the API was pretending it was a flat list of endpoints.

This is the time when I worked on woss.io and started improving the Macula MCP. Implement feature on Macula MCP, deploy, back to woss.io, test, repeat.

I built `traverse` — a single `from(node) → edge(relationship) → results` tool — and collapsed 14 specialized tools into 4: `traverse`, `get_file`, `get_file_metadata`, `get_users`. The LLM stopped guessing. It just navigated. 🎉

A few more iterations followed. Renamed `url` to `rawDataUrl` so the LLM knew it was a download link, not a web page. Separated discovery from consumption by removing `_links` from traverse output. Rewrote tool descriptions from graph-theory jargon ("from(node) → edge(relationship) → results") to task-oriented prose ("Explore files by directory, user uploads, or keyword search") after the model hallucinated files because it didn't understand "traverse." Reduced 14 prompts to 4 task-oriented patterns. I documented the full evolution in [Designing MCP Servers for How LLMs Think](/posts/macula-designing-mcp-for-llms) — it taught me more about how LLMs consume tool APIs than anything else.

But now the AI had two tool-kits: GitHub (repos, code, issues) and Macula (photos, media, metadata). And zero instructions on which one to grab.

That question gave birth to the tool routing architecture. Keyword scanning grew a second path — `needsGithubTools()` for "repo" and "PR", `needsMaculaTools()` for "photo" and "portfolio". The system prompt receives conditional sections. A lightweight LLM call became the tiebreaker for fuzzy "show me your work" messages. One LLM, two tool-kits, zero confusion.

I tested locally, putting myself in a recruiter's shoes — I've been on both sides of the hiring table — asking "give me honest evaluation of daniel for senior SRE role" and "how does he fit an AI evangelist role focused on driving AI adoption?" and watching the AI pull my entire professional profile — repos, PRs, contributions, photography, career history — into answers that compared me against each role. This would've been a massive time saver when I was hiring.

Me happy!

### Phase 3: The Model Switch That Broke Everything

Then I tried switching models. DeepSeek → Qwen → Gemma → Mistral. Each model expected tool calls in a different format.

- DeepSeek: OpenAI-compatible JSON function-calling. Clean, standard.
- Qwen: Hybrid — OpenAI JSON via API, XML-like `<|tool_call_start|>` tags via Qwen-Agent.
- Gemma: No native tool-call format — relies on generic chat template. Inconsistent with nested schemas.
- Mistral: Native JSON with strict grammar enforcement. `[TOOL_CALLS][FUNC_NAME][ARGS]{json}` wire format.

Though DeepSeek's API translates this to JSON, the raw model output uses DSML (DeepSeek Markup Language) — XML with `<｜DSML｜tool_calls>` tags.

The result was a stream of `<tool_calls>` XML leaking into the answer text. The synthesis round — designed to produce the final answer without calling more tools — made it worse by removing tool definitions mid-response. Models that expected tools hallucinated their calling format. Every model had its own dialect for tool calling and none of them warned you until the output was already on the page.

Here's how it broke: round 1 ran with tools, model called them fine. Round 2 was a synthesis round with a different system prompt and no tool definitions. The model, having just used tools, now found them missing — so it tried to call them anyway, outputting `<tool_calls>` XML as raw text. That leaked into the answer on the page.

The fix was architectural — not a patch. Remove the synthesis round entirely. Every round now runs with identical tools, system prompt, and model instance. The model always has native function calling available. No format drift because the context never changes between rounds.

This became the "Multi-Round Invariant Architecture" — every round identical, recursion capped at MAX_ROUNDS (default 3), text continuity enforced by a `\n\n` separator between rounds. Tools (both GitHub and Macula) are always available, so the model never needs to guess the format — whether it's searching repos or browsing portfolio images.

I have to mention that none of this "Multi-round Invariant Architecture" would be possible without the amazing [Opencode](https://opencode.ai/) code. I researched how they handle this because that's exactly the agent I used, and it's amazing, sometimes spits out the DSML tags but it works, and I learned a lot from their code. I also learned that the model is not perfect, and sometimes it will hallucinate, but with the right prompts and the right architecture, you can minimize that.

If anyone from Opencode reads this, thank you for your work, it helped me a lot. KUDOS to you ❤️❤️❤️.

### Phase 4: Minimizing the LLM

With multi-round tool calling working, a new problem surfaced: **cost and latency**. Every question hit the LLM — even the simple ones. "Where did Daniel work in 2023?" doesn't need a 284B parameter model. It needs a vector search. I started researching ways to minimize LLM calls. I knew already about embeddings, I used them in [DaliMemory](https://github.com/woss/dali), but I needed a more robust solution. I wanted to avoid LLM calls for questions that could be answered with cached responses or vector search. Somehow in the rabbit hole of research I found a solution, something called "centroid-based query classification". It was a game changer.

The solution is a three-layer decision system:

**1. Centroid-based query classification.** Pre-compute centroids for question types — `RAG`, `tool`, `hybrid`, `meta`. After embedding, compare the query vector against centroids to determine what it needs. Tool-only questions skip RAG entirely. Classification takes ~5ms with zero LLM calls.

**2. RAG-only path.** For factual knowledge questions, the centroid classifier routes directly to vector search. Top-8 most similar chunks (selected via round-robin across sources for diversity) are packed into the system prompt. The LLM answers from context alone — no tool calls, no multi-round overhead.

**3. LLM cache.** Stores responses for identical and near-identical questions. Same embedding plus cosine similarity against previous queries. Cache hit returns in under 50ms with zero LLM inference. Configurable similarity threshold — tune between exact-match-only and close-enough.

**4. Meta question filter.** Haistlin Persona

The flow works like this: a question comes in, gets embedded, checks the cache. Cache hit returns immediately. Cache miss hits the centroid classifier — if it's a RAG question, vector search feeds context directly to the LLM with no tool calls. Tool questions skip RAG and load MCP tools for multi-round execution. Hybrid questions do both. The result gets cached for next time.

The result: roughly 60% of questions never hit the LLM at full depth. Cache handles repeats, centroid classification prevents unnecessary RAG searches, and the RAG-only path cuts latency by half for factual queries. The full multi-round tool flow — whether calling GitHub for repos or Macula for portfolio images — only runs when actually needed.

## The AI Chat: Core Architecture

The chat is the heart of the site. Every question hits a pipeline that looks like this:

> User types question
> → save message, return 202 (generation runs in background)
> → early gates (relevance filter, polite-only path, cache check)
> → embed query (Transformers.js, local ONNX)
> → classify query (centroid similarity: RAG? tool? hybrid?)
> → if RAG: vector search (USearch, top-k chunks) → build prompt with context
> → classify tool needs (keyword fast path + LLM fallback)
> → load MCP tools (GitHub, Macula)
> → stream LLM response with multi-round invariant tool calling
> → save answer + emit SSE done event

Under the hood: the two-layer relevance gate and chat-lock mechanism. Before any processing, a lightweight LLM check (`isRelevant()`) determines if the question is about Daniel's professional portfolio. If not, the AI returns a firm refusal — there are three tries then permanently locks the chat (`chat.locked = 1` in SQLite) so future messages are rejected at the API level. A webhook fires to log the event. Polite messages (thanks, bye) bypass the gate entirely.

### Streaming

The streaming pipeline uses the [Vercel AI SDK](https://sdk.vercel.ai/docs) with Effect.ts for typed event streaming:

> chatStreamWithTools()
> → Effect.Stream<LLMEvent>
> → text-delta, reasoning-delta, tool-call, tool-result, step-finish, finish

Each SSE event from the LLM is parsed and emitted as typed LLMEvent objects — text deltas for real-time token display, tool call events for rendering MCP tool execution status, step-finish events for tracking reasoning progression.

The frontend subscribes via Server-Sent Events:

```typescript
// Frontend: each token appended directly to message text
const source = new EventSource(`/api/ask/${chatId}`);
source.addEventListener('token', (e) => {
  const data = JSON.parse(e.data);
  messages[idx].text += data.token;
});
```

No frontend buffering. No message assembly. Each token arrives and renders.

### RAG Pipeline

When a question comes in, we embed it locally, search the vector index for relevant content, select the top-8 chunks via round-robin across sources for diversity, and pack them into the system prompt:

> You are an AI assistant for woss.io.
> Answer based on these sources:
> [1] "Experience: Ipsos Simstore" — Senior DevOps, Platform Architect...
> [2] "Post: Building opencode-visualizer" — Deno, SQLite, ANSI...
> [3] "Experience: Web3 Foundation Grants" — Substrate, WASM...
>
> If the answer isn't in the sources, use available MCP tools.

The RAG prompt is built by `buildRagPrompt()` in `openai-provider.ts`. Sources are rendered with title, URL, and key content — the LLM reads them as context. Tool-classified queries skip the RAG search entirely, reducing latency when the answer will come from MCP tools. Took me three iterations to realize most questions don't need tools — the model was searching GitHub for things I'd already given it in the prompt.

### Tool Calling via MCP

This is where it gets interesting. The site uses the Model Context Protocol to give the LLM access to real tools:

- **GitHub MCP** — search repositories, list issues, read files, explore pull requests
- **Macula MCP** — search images, browse keywords, traverse media collections

When a user asks "What projects do you have on GitHub?", the LLM doesn't make up an answer. It calls `search_repositories` via MCP, reads the results, and summarizes them. Real data, every time. When someone asks "Show me your photography work", the LLM calls `get_users` and `traverse` on Macula to browse the actual photo portfolio — no stock images, no hand-picked samples, just the real collection.

Tool classification is three independent systems that fire at different pipeline stages:

1. **Query classification** (centroid): After embedding, the vector is compared against pre-computed centroids to determine if this is a RAG question, a tool question, or hybrid. Tool-only queries skip the RAG search entirely.

2. **Keyword fast path**: `needsGithubTools()` and `needsMaculaTools()` scan for explicit references ("GitHub", "repos", "code", "photos", "portfolio"). No LLM call — pure regex.

3. **LLM fallback for ambiguity**: When the message is short (≤6 words) and keywords are inconclusive, `classifyToolNeeds()` makes a lightweight call to a classification-only LLM endpoint. Returns `github`, `macula`, `both`, or `none`. Fail-safe always returns `none`.

The results feed into `getMcpToolDefs()` which loads the actual MCP tool definitions and injects tool-awareness into the system prompt.

### Retry Logic & Fallbacks

LLMs are unreliable. The `streamWithRetry()` system handles multiple failure modes:

1. **Empty answer**: LLM produced no text-delta characters at all
2. **Doom loop**: LLM called tools but produced zero answer text
3. **XML tool call leak**: LLM outputs `<tool_calls>` as raw text instead of native JSON — stripped by a `ToolCallXmlStripper` state machine that handles tags split across stream chunks
4. **Raw JSON tool calls**: LLM emits function names followed by JSON as prose — caught by a regex safety net and replaced with a fallback message

On retry, tools are disabled and the system prompt is hardened with a mandatory instruction to produce text without calling tools. Up to 10 attempts — the user always gets something, even if it's partial. You learn to distrust the model output around attempt 3.

### Multi-Round Invariant Architecture

The streaming pipeline originally used a dual-streamText design — round 1 ran with tools enabled, then a separate "synthesis" round ran with a different system prompt urging the model not to call more tools. This caused model format drift: when tool definitions changed between rounds, the model would output `<tool_calls>` XML as raw text instead of native JSON function-calling, leaking tool call syntax into the answer.

The fix was architectural — replace the synthesis round with recursive `runRound()` calls. Every round now shares identical tools, system prompt, and model instance. After tool results are injected as messages, the next round recurses with the same invariant configuration. A `MAX_ROUNDS` config (default 3) caps recursion depth, and the safety net in generate.ts catches indefinite loops.

Key results:

- No format drift — model always has native function calling available
- No synthesis system prompt needed — model synthesizes naturally from prior results
- Text continuity enforced between rounds via `\n\n` separator
- `getSynthesisSystemPrompt()` and `synthesisMaxSteps` config removed as dead code

## Local Embeddings: The Surprising Beast

Running a local embedding model in a Node.js server was the most technically interesting challenge.

```typescript
// embed.ts — lazy-loading ~1.3GB model via Transformers.js
async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (_extractor) return _extractor;
  if (!_extractorPromise) {
    _extractorPromise = pipeline('feature-extraction', EMBEDDING_MODEL, {
      dtype: 'fp32',
    }).then((p) => {
      _extractor = p;
      return _extractor;
    });
  }
  return _extractorPromise;
}
```

## Key design decisions

**Promise-based mutex for first load**: The model is ~1.3GB and takes 5-10 seconds to load on first request. Multiple concurrent requests on a cold start would each trigger a separate model load without the mutex. With it, they all await the same promise.

**Cache directory inside data volume**: `env.cacheDir = join(process.cwd(), 'data', '.hf-cache')` — this survives container rebuilds so the model isn't re-downloaded on every deployment.

**Batch inference for indexing**: `embedTexts()` processes multiple texts in one ONNX inference call. Building the initial search index over 1000+ content chunks would be slow one-at-a-time. Batch inference cuts the time by ~10x.

**Pooling and normalization**: Mean pooling across token embeddings + L2 normalization. The BGE model's output is pooled to a single 1024-dimensional vector per text.

## Vector Search with USearch

USearch is a lightweight vector similarity library. No server, no external dependencies — just a file index.

> // Loading the index
> const idx = new Index(SEARCH_INDEX_CONFIG);
> idx.load('./data/woss.usearch');
>
> // Search
> const matches = idx.search(queryVector, searchLimit, 0);
> // Returns { keys: BigUint64Array, distances: Float64Array }

The index stores chunk IDs. We map those back to content in SQLite: `SELECT title, content, type, slug FROM page_chunks WHERE id IN (?, ?, ?)`

The join of vector similarity + SQLite metadata is fast enough for real-time responses. No Postgres, no Pinecone, no Qdrant. One file, zero network calls.

## The Experience Timeline

The career history page was a design challenge. Most portfolio sites show a boring list of jobs with dates. I wanted something visual — bars spanning time ranges, color-coded by era, with rich detail on click. Then it hit me, gantt charts are perfect representations of career timelines.

The data model is simple markdown files with YAML frontmatter:

```yaml
---
 company: 'The company name'
 role: 'Senior DevOps, Platform Architect & AI Adoption Lead'
 startDate: '2023-08'
 endDate: null # current position
 endDate: '2024-06' # or end date if not current
 company_tags:
  - market research
  - data-driven insights
 skills:
  - aws
  - terraform
  - kubernetes
 ---
```

All entries spanning my career — from founding startups to Web3 Foundation grants to DevOps architecture. Each entry renders as a horizontal bar positioned absolutely along a timeline axis, with `startDate` and `endDate` mapping to CSS `left` and `width`.

Users can click any entry for full details, or use "Copy as Markdown" / "Copy as llms.txt" to export for LLM context files.

## The Blog System

Blog posts are markdown files in `src/content/posts/` with YAML frontmatter:

```yaml
---
title: 'Building opencode-visualizer: A Terminal Dashboard...'
description: 'A terminal dashboard for OpenCode usage data...'
date: 2026-06-04
featured: true
tags:
  - opencode
  - CLI tools
- Deno
header_image: '[Alt](https://example.com/image.png)'
---
```

The build pipeline ingests them into SQLite:

> // build-index.ts
> import { parseFrontmatter } from '../content/index.js';
> import { Index } from 'usearch';
> import Database from 'better-sqlite3';
>
> // Parse frontmatter → embed → index vectors → store in DB

Rendering uses `unified` + `remark-parse` + `remark-rehype` + `rehype-highlight` for syntax highlighting + `rehype-slug` for heading anchors. The TOC is extracted via regex heading matching during indexing and stored alongside the rendered HTML.

The result: fast page loads (content is pre-rendered at build time and served from SQLite), syntax-highlighted code blocks, and navigable heading structure.

## Design Philosophy

The visual design follows a few principles:

**Dark mode first**. The site is designed in dark mode, with light mode as a secondary concern. Dark mode isn't an afterthought — it's the primary experience. Took me 10 years of making ugly light-mode sites to admit I'm a dark-mode person.

**Typography as structure**. The font stack tells the hierarchy: `IBM Plex Mono` for headings, `IBM Plex Sans Variable` for body text, `IBM Plex Mono` with `JetBrains Mono` fallback for code. All self-hosted via npm `@fontsource`.

**Minimal UI, maximal functionality**. The chat page is just messages and an input. No buttons, no toolbars, no settings panels. The experience page is bars and dates. The blog is a grid of cards with header images. Each page does one thing. I took liberty to experiment with the UI, especially the chat page, where navigation is offloaded to slash commands. I find it very useful on small screens, and it keeps the UI clean. The slash commands are discoverable via left sidebar or clicking `/` button or typing the `/` character in input.

## What Building This Taught Me

**Local embeddings are viable**. I started this project assuming I'd need an external embedding API (OpenAI, Cohere, etc.). Transformers.js proved me wrong. The BGE model runs comfortably in a $10/month VPS. Inference takes ~50ms per query. No API costs, no rate limits, no data leaving the server.

**MCP changes everything about portfolio AIs**. Without MCP, the LLM would guess about my GitHub projects and fabricate photos. With it, it searches my actual repos, reads my actual code, browses my actual photo portfolio via Macula, lists my actual issues. The difference between "sounds plausible" and "provably correct" is night and day. But none of this worked until I stopped designing tools for developers and started designing them for how LLMs process information — the graph-walk pattern (`traverse`) replacing 14 specialized endpoints was the turning point. [Designing MCP Servers for How LLMs Think](/posts/macula-designing-mcp-for-llms) documents the full evolution. The first thing I did after getting it working was put on my hiring-manager hat — watched the AI pull my real repos, real PRs, real photos into answers comparing me against specific roles. Things I'd have spent hours digging for myself.

**Effect.ts streams beat callbacks**. The first version of the streaming pipeline used raw Node.js callbacks. It was brittle — unhandled errors in middle of a stream would crash the response. Effect.ts's typed `Stream` type provides structured error handling, backpressure, and composability that callbacks cannot match.

**Tool availability must be invariant across response rounds**. Early architecture ran round 1 with tools, then a separate synthesis round with a different system prompt — the model leaked XML tool calls as text whenever tool definitions changed mid-response. Switching to recursive `runRound()` with identical tools, prompt, and model instance every round eliminated the format drift entirely. The synthesis prompt was removed; the model synthesizes naturally when it has access to all prior results.

**Svelte 5 Runes are genuinely good**. I was skeptical of the Runes API after years with Svelte 4 stores. After building with it, I'm converted. `$state()` with `$derived()` replaces most store patterns more cleanly. The `$effect()` lifecycle hook is explicit about when and why side effects run. TypeScript integration is seamless.

**Rate limiting is essential**. An unprotected AI chat endpoint would be bankrupt in hours. The IP-based rate limiter (`src/lib/server/rate-limiter.ts`) uses SQLite for persistent counters with a sliding window — 10 requests per minute, consistently enforced across all endpoints. The system does not block — it slows and warns.

**Your personal site should prove what you build**. The site is a showcase, but it's also a testbed. MCP integration, local embeddings, streaming LLM responses — these are technologies I work with daily, and the site proves they work in production. A static portfolio page tells people what you've done. An AI-powered one shows them.

**System prompt position matters as much as content.** The "no invention" rule was on line 84 — sandwiched between identity and style instructions, reading like a suggestion, not a constraint. Research confirms LLMs exhibit primacy bias — instructions at the top carry more weight, middle content gets de-prioritized. Moving the anti-hallucination rule to the second paragraph — right after role definition — put the most critical instruction in the primacy zone without changing a single word of content. System Prompt Position Matters documents the full analysis and restructured prompt.

## What's Next

- **Multi-LLM routing**: Route questions to specialized models — code questions to DeepSeek, creative questions to Claude, quick answers to a small local model
- **Real-time collaboration**: Shared chat sessions for collaborative debugging with visitors
- **Expanded MCP tools**: Add more data sources — blog RSS feeds, conference talks, open-source contributions
- **Spatial embedding visualization**: A 3D embedding space explorer (already prototyped in [embedding-space-3d.html](/misc/embedding-space-3d.html)) to visualize how my career and content cluster in vector space.

## Easter Egg

If you get it then you get it. Please share it on LinkedIn if you do. :)

```ascii
-------------- Haiku 1 --------------------
Empty conversation
Cauldron waits for your question
Forty-two replies

-------------- Haiku 2 ---------------------
Wizard needs your words
Crystal ball is foggy now
Ask and I'll answer

-------------- Haiku 3 ---------------------
No messages sent
Cauldron empty, yet it speaks
Magic without words

-------------- Haiku 4 ---------------------
Empty chat summoned
Beam me a query, it says
Starship needs a course

-------------- Haiku 5 ---------------------
The crystal ball asks
What question brews in silence?
Empty, it answers
```

---

The code is open source at [github.com/woss/woss.io](https://github.com/woss/woss.io). The site runs on a cheap VPS with SQLite, USearch, and Transformers.js — the only cloud API dependency is the LLM provider.

Is it over-engineered? Probably. But I'd rather show you what I can build than tell you.
