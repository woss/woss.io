---
published: false
title: 'SQLite to SurrealDB Migration'
slug: 'sqlite-to-surrealdb-migration'
description: 'Why I ripped out 989 lines of better-sqlite3 and USearch for SurrealDB — and the CBOR, SDK, and NaN bugs that taught me how RecordIds actually work.'
date: 2026-07-13
tags:
  - SurrealDB
  - SQLite
  - migration
  - database
  - TypeScript
  - woss.io
featured: false
part_of_series: 'building-woss-io'
---

woss.io ran on SQLite for its first half a month. A single file, `db.ts`, did everything: user management, chat storage, vector search for RAG, LLM response caching, rate limiting, page posts, contact forms. 989 lines, 32 exported functions, 40 files importing from it. Eighty-seven raw SQL strings scattered throughout.

The problem wasn't that SQLite was broken. It was that on every little change, like a blogpost or experience, I have to rebuild the entire OCI. Why? Because of the deployment architecture. It's a simple docker-compose setup, with an `init` container that initializes or updates the database. The main container runs the app and depends on the success of the `init`. It's simple, but it's not flexible. I did it like this because I wanted to ship the woss.io fast, so this was a tradeoff. Now I want to update the DB on release in Github Actions, and if there are no code changes, I don't need to rebuild the OCI.

## The Tools

This is the first time I had an agent do an entire migration. I wanted to see if it is true what people are saying about vibe coding. Don't forget that I am not a newbie with SurrealDB, if you don't believe me check the [DaliORM]('../posts/daliorm-announcement.md') post. I have been using SurrealDB for a while now, and I have a good understanding of its features and capabilities. Also I am not newbie with AI coding tools either. My AI flow is more focused on the research and planing, less on coding. The AI does write the code but I do also, then I review it and refine it or tell it what are the issues. This was a first time I did it with 100% AI, and guess what, it _WAS NOT_ as straight forward as many people say.

List of coding tools:

- [opencode](https://opencode.ai/?ref=woss.io)
- [opencode-swarm](https://github.com/ZaxbyHub/opencode-swarm/?ref=woss.io) for the multi-agent orchestration
- [opencode zen](https://opencode.ai/zen?ref=woss.io) (because it gets me the top models)
- fable 5 for planing and reasoning
- glm-5.2 and deepseek-v4-flash for coding
