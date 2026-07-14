# Chunk Schema Migration: Edge-Based Re-Index

## Why Re-Index Is Required

The chunk schema has moved from embedded `slug`/`type` fields to edge-based `has_chunks` relationships:

**Before:** Chunks stored `slug` and `type` directly as fields.
**After:** Chunks have `page_posts:xxx --has_chunks--> chunks:xxx_chunk_0` edges.

Existing chunks in the database have **no edges**. Search results won't return parent identity (`slug`/`type`) for those chunks until edges are created.

## When to Re-Index

After deploying the edge-based schema changes. Any chunks inserted before the deploy will lack edges until re-indexed.

## How to Re-Index

Run the build script:

```bash
bun run build
```

This executes `src/scripts/build-index.ts`, which recreates all chunks with their edges.

## What Happens During Re-Index

1. Existing chunks are deleted (or left orphaned depending on your cleanup strategy)
2. Documents are re-indexed, creating chunks with proper `has_chunks` edges
3. Search results return correct `slug`/`type` again via edge traversal

**Note:** Full re-index required — no incremental migration possible.

## Rollback

If you need to revert:

1. Revert the code changes to restore embedded `slug`/`type` fields
2. Re-run `bun run build` to re-index with the old schema

## Compatibility

- Chunk ID format (`slug_chunk_N`) stays the same
- `SearchResult` shape is **unchanged** for consumers
- No changes needed in client code that consumes search results
