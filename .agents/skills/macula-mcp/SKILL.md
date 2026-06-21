---
name: macula-mcp
description: Macula DAM query tools — traverse graph, get files, user profiles, metadata. Use for: file searches, user portfolio browsing, keyword/album/directory queries, EXIF inspection, image URL construction.
license: terms in LICENSE.txt
---

# How to Use This Skill

1. **Load it**: Agent calls `skill macula-mcp` — injects full tool ref + graph model + workflows into context. Then agent can call macula-mcp tools.

2. **Tool names** (registered MCP tools, callable directly):
   - `macula-mcp_traverse` — graph walk for discovery/search/browse
   - `macula-mcp_get_file` — file metadata with field selection
   - `macula-mcp_get_file_metadata` — EXIF/XMP/IPTC raw metadata
   - `macula-mcp_get_users` — batch user lookup

3. **Typical flow**:
   - Search: `traverse(from:{type:'root'}, edge:'search', query:'...')`
   - Browse user: `get_users({nicknames:['woss']})` → traverse with `edge:'contains'` on each directory
   - Get file: `get_file({unifiedId:'...', fields:['title','_links.raw']})`
   - Build URL: `{_links.raw}?preset=sys_lg`

4. **If agent refuses** ("I can only answer about X"): macula-mcp tools not loaded. Reload session + `skill macula-mcp` explicitly.

5. **Instructions resource**: `macula-mcp://instructions` — embedded reference doc with full conceptual model. Many clients fetch it automatically.

---

# Macula MCP Skill

## Overview

macula-mcp = read-only graph API over Macula DAM at `https://u.macula.link/mcp`. Version 0.7.0. 4 tools, 1 resource, 4 prompts. No auth (public). Stateless. Rate-limited 200/min.

## Tool Reference

### traverse

Universal discovery — graph walk from a node across an edge.

Input:

| Param    | Type   | Required | Description                                                                                                                                                                 |
| -------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- | -------------------------------------- |
| `from`   | object | yes      | Start node: `{type:'user',nickname}` / `{type:'keyword',keyword}` / `{type:'license',license}` / `{type:'directory',pathCid}` / `{type:'file',unifiedId}` / `{type:'root'}` |
| `edge`   | enum   | yes      | One of: `uploads`,`tagged_files`,`has_license`,`contains`,`random`,`recent`,`search`,`keywords`,`profile`,`info`                                                            |
| `query`  | string | no       | Required for `search` and `keywords` edges                                                                                                                                  |
| `filter` | object | no       | `{what:'images'                                                                                                                                                             | 'videos' | 'files' | 'all', allowAI:bool, nickname:string}` |
| `limit`  | int    | no       | 1-100, default 20                                                                                                                                                           |
| `after`  | string | no       | Opaque cursor from previous response. Pass `after` value to get next page.                                                                                                  |

Output: `{items:Node[], total:int, after:string|null}` — `after:null` means last page.
Single-item edges (profile, info): `{items:[Node], total:1, after:null}`.

### get_file

Fetch single file metadata.

Input:

| Param       | Type     | Required | Description                                                                    |
| ----------- | -------- | -------- | ------------------------------------------------------------------------------ |
| `unifiedId` | string   | yes      | 1-64 chars, regex `^[a-zA-Z0-9_-]+$`                                           |
| `fields`    | string[] | no       | JSONPath dot-notation: `["title","_links.raw","ai.model"]`. Omit = all fields. |

Output: Full file metadata blob + links + AI info. Fields param returns only requested keys.

### get_file_metadata

Full EXIF/XMP/IPTC raw metadata.

Input:

| Param       | Type     | Required | Description             |
| ----------- | -------- | -------- | ----------------------- |
| `unifiedId` | string   | yes      | Same as get_file        |
| `a`         | string[] | no       | Specific metadata paths |

Output: Flat key-value metadata blob (camera, GPS, copyright, creation date).

### get_users

Batch user lookup.

Input:

| Param       | Type     | Required | Description                                               |
| ----------- | -------- | -------- | --------------------------------------------------------- |
| `nicknames` | string[] | yes      | 1-100 nicknames, each 1-32 chars, regex `^[a-zA-Z0-9_]+$` |

Output: `{items:(UserNode|null)[]}` — preserves order, null for not-found.

## Graph Model

traverse is a graph walk. `from` = start node, `edge` = relationship to follow.

### Edge Compatibility

| edge           | from.type | query? | returns            | paginated |
| -------------- | --------- | ------ | ------------------ | --------- |
| `uploads`      | user      | no     | File[]             | yes       |
| `tagged_files` | keyword   | no     | File[]             | yes       |
| `has_license`  | license   | no     | File[]             | yes       |
| `contains`     | directory | no     | File[]             | yes       |
| `random`       | root      | no     | File[]             | yes       |
| `recent`       | root      | no     | File[]             | yes       |
| `search`       | root      | yes    | File[]             | yes       |
| `keywords`     | root      | yes    | Keyword[]          | yes       |
| `profile`      | user      | no     | User (single)      | no        |
| `info`         | file      | no     | File (single)      | no        |
| `info`         | directory | no     | Directory (single) | no        |

### Why separate tools

traverse returns lightweight FileNodes. For richer data use:

- **get_file**: full metadata + \_links + AI/copyright fields
- **get_file_metadata**: raw EXIF/XMP/IPTC bytes
- **get_users**: batch lookup with enriched User nodes + directories

## Node Shapes

Every node has `__typename` discriminator — check it to know fields available.

### File (\_\_typename: "File")

| Field        | Type     | Notes                                               |
| ------------ | -------- | --------------------------------------------------- | ----------------------------------------------- |
| id           | string   | unifiedId                                           |
| title        | string   | null                                                |                                                 |
| kind         | enum     | image\|video\|audio\|generic\|svg                   |
| mimeType     | string   | null                                                |                                                 |
| rawDataUrl   | string   | raw download URL — base + `?preset=` for renditions |
| htmlPageUrl  | string   | page URL (web view)                                 |
| buyPageUrl   | string   | purchase URL                                        |
| thumbnailUrl | string   | null                                                | images/svg only — rawDataUrl + `?preset=sys_sm` |
| fileSize     | int      | null                                                | bytes                                           |
| publishedAt  | string   | ISO 8601                                            |
| license      | string   | null                                                | short code: cc-by, cc-by-sa, arr, cc-0          |
| owner        | object   | `{nickname, displayName, avatarUrl}`                |
| keywords     | string[] | tags                                                |
| directory    | object   | null                                                | `{pathCid, name}`                               |
| dataMining   | enum     | ALLOWED\|UNSPECIFIED\|DENIED                        |

### User (\_\_typename: "User")

| Field       | Type        | Notes                 |
| ----------- | ----------- | --------------------- | ---------------------------------- |
| id          | string      | nickname              |
| nickname    | string      |                       |
| displayName | string      | null                  |                                    |
| avatarUrl   | string      | null                  |                                    |
| bio         | string      | null                  |                                    |
| fileCount   | int         | published files count |
| createdAt   | string      | ISO 8601              |
| directories | Directory[] | undefined             | from `profile` edge or `get_users` |

### Directory (\_\_typename: "Directory")

| Field     | Type   | Notes                                                |
| --------- | ------ | ---------------------------------------------------- |
| id        | string | pathCid                                              |
| pathCid   | string | used in traverse `from: {type:'directory', pathCid}` |
| name      | string | album/folder name                                    |
| fileCount | int    |                                                      |

### Keyword (\_\_typename: "Keyword")

| Field   | Type   | Notes                          |
| ------- | ------ | ------------------------------ |
| keyword | string | tag name                       |
| count   | int    | files tagged with this keyword |

## Image Presets

Every image supports on-the-fly renditions via `{rawDataUrl}?preset={name}`.

| Preset     | Dimensions    | Format   | Use               |
| ---------- | ------------- | -------- | ----------------- |
| sys_sm     | 500px         | AVIF     | thumbnails, grids |
| sys_md     | 900px         | AVIF     | article inline    |
| sys_lg     | 1200px        | AVIF     | hero, featured    |
| sys_xl     | 2048px        | AVIF     | full screen       |
| sys_2xl    | 4096px        | AVIF     | print quality     |
| sys_3xl    | 8192px        | AVIF     | archival          |
| sys_orig   | original q80  | original | max quality       |
| thumbnail  | 100x80        | AVIF     | UI tiny thumb     |
| avatar     | 96x96 circle  | AVIF     | profile pics      |
| open_graph | 1280x720      | JPG      | social cards      |
| blur       | 300px blurred | AVIF     | placeholders      |

Pattern: `![title]({rawDataUrl}?preset=sys_lg)` for images.
Video: `<video src="{rawDataUrl}" poster="{rawDataUrl}?preset=thumbnail" controls></video>`.
Audio: `<audio src="{rawDataUrl}" controls></audio>`.

## Filters

All file-returning edges accept `filter` object:

- `filter.what`: `"images"` | `"videos"` | `"files"` | `"all"`
- `filter.allowAI`: boolean — returns files with dataMining ALLOWED or UNSPECIFIED
- `filter.nickname`: string — restrict to specific user's files

## Pagination

Paginated edges return `{items, total, after}`. Pass `after` value into next call's `after` param. `after:null` = done.

```ts
const page1 = traverse({ from: { type: 'user', nickname: 'woss' }, edge: 'uploads', limit: 20 });
const page2 = traverse({ from: { type: 'user', nickname: 'woss' }, edge: 'uploads', limit: 20, after: page1.after });
```

## Common Workflows

### 1. Search files by keyword

```ts
traverse({ from: { type: 'root' }, edge: 'search', query: 'sunset', filter: { what: 'images' } });
```

### 2. Browse user profile + directories

```ts
// Step 1: user info + directory list
get_users({ nicknames: ['woss'] });
// → directories: [{name, pathCid, fileCount}]

// Step 2: files in a directory
traverse({ from: { type: 'directory', pathCid }, edge: 'contains', limit: 20 });
```

### 3. List recent uploads

```ts
traverse({ from: { type: 'user', nickname: 'woss' }, edge: 'uploads', limit: 10 });
```

### 4. Get random images (discovery mode)

```ts
traverse({ from: { type: 'root' }, edge: 'random', filter: { what: 'images' }, limit: 5 });
```

### 5. Inspect EXIF / camera metadata

```ts
get_file_metadata({ unifiedId: 'abc123' });
```

### 6. Selective field retrieval

```ts
get_file({ unifiedId: 'abc123', fields: ['title', '_links.raw', 'ai.model', 'license'] });
```

### 7. Build image URLs

```ts
const file = get_file({ unifiedId: 'abc123', fields: ['_links.raw', 'title', 'mime'] });
const lg = `${file._links.raw}?preset=sys_lg`;
const og = `${file._links.raw}?preset=open_graph`;
```

### 8. List all keywords matching prefix

```ts
traverse({ from: { type: 'root' }, edge: 'keywords', query: 'wind' });
```

## Edge Cases & Traps

- **get_users** directories show name + fileCount but NOT the actual files. Always use traverse `edge:'contains'` to list files in a directory.
- **pathCid** from `get_users` response's `directories[i].pathCid` — pass to traverse `from: {type: 'directory', pathCid}`.
- **traverse `search`** uses pg_trgm similarity. Query > 3 chars recommended. Short queries return few results.
- **`keywords` edge** requires `query` param (prefix match). Empty query returns error.
- **unifiedId regex** `^[a-zA-Z0-9_-]+$` — no spaces, no special chars.
- **Nickname regex** `^[a-zA-Z0-9_]+$` — alphanumeric + underscore.
- **Rate limits**: 100 req/min slow-down, then 200 req/min hard limit per session.
- **Fabricated pathCids** return empty results — no error, just 0 items.
- **Presets** need no trailing slash on URL. Pattern: `{rawDataUrl}?preset=sys_sm` NOT `{rawDataUrl}/?preset=sys_sm`.
- **get_file** returns structuredFileContent + text. Use structuredFileContent when field access needed.
- **traverse pagination** cursor is opaque base64url JSON — don't decode, just pass through.
- **get_file** output includes full `_links` object — traverse File nodes do NOT have `_links`.

## Resource

Read instructions doc: `macula-mcp://instructions` — full conceptual model + code examples.

## Prompts (4)

| Prompt              | Args       | Use                              |
| ------------------- | ---------- | -------------------------------- |
| `browse_user`       | nickname?  | Walk user profile → dirs → files |
| `display_media`     | unifiedId? | Render file with presets         |
| `explore_directory` | pathCid?   | Deep-dive directory structure    |
| `inspect_metadata`  | unifiedId? | EXIF/copyright/AI analysis       |
