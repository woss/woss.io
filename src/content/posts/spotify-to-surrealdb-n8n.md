---
published: true
title: 'Spotify Account sync to SurrealDB with n8n'
slug: 'spotify-to-surrealdb-n8n'
featured: true
description: 'How I built a workflow to sync my Spotify account to SurrealDB using n8n, and how you can do it too.'
date: 2026-05-06
tags:
  - Spotify
  - Data ownership
  - TypeScript
  - SurrealDB
  - n8n
  - automation
header_image: '[Space whale](https://u.macula.link/KdGkDiG_S-SqfqDpIJE-Sw-7)'
workflow_files:
  - label: 'Spotify Sync Workflow'
    file: 'spotify-workflow.json'
    placeholders:
      - key: surrealdb-cred-id
        label: 'SurrealDB Credential ID'
        hint: 'Found in n8n URL: /credential/surrealdb-cred-id'
      - key: spotify-cred-id
        label: 'Spotify Credential ID'
        hint: 'Found in n8n URL: /credential/spotify-cred-id'
---

After 15 years on Spotify, I've got 116 playlists and over 25,000 songs. That's a decade and a half of listening history, full of genre obsessions and playlist trades and phases I'd rather forget. All of it locked to one platform. That's the real lock-in. Not the payout debates or the algorithm complaints. The library you can't easily take with you.

I wanted my music data somewhere I actually control. Queryable, relational, something I could point other tools at without going through Spotify's API every time. So I built a workflow: n8n pulling from the Spotify API, writing into SurrealDB. Playlists, liked tracks, followed artists. The whole graph, synced and mine.

## Why SurrealDB + n8n

I landed on this stack after trying a few other approaches. Here's the thinking behind each choice.

**SurrealDB over Postgres or SQLite.** The music domain is a graph: tracks belong to albums, albums have artists, playlists contain tracks, users like tracks. You _can_ model that with foreign keys in Postgres, but SurrealDB makes graph edges a first-class concept. The `->likes_track->` and `->playlist_track->` relations are stored as edges, not join table rows. SurrealDB also has UPSERT built in: define a unique index and `UPSERT` either creates or updates a record in one call. No read-check-write cycle. And live queries let me subscribe to changes without polling. [Install docs here](https://surrealdb.com/docs/surrealdb/installation/running/docker).

**n8n over a Python script or cron.** This could have been a Python script on a cron job. I've written those before. What n8n gives you is visual feedback while you're building. You can run one node at a time, inspect the output, and see exactly where something broke. That's invaluable when you're dealing with an API that paginates unpredictably and a database that serializes types differently than you expect. n8n also handles scheduling, retries, and OAuth token refresh out of the box. [Install docs here](https://docs.n8n.io/hosting/installation/docker/).

**Self-hosted n8n specifically.** The SurrealDB integration is a community node ([`n8n-nodes-surrealdb`](https://github.com/nsxdavid/n8n-nodes-surrealdb)) that isn't verified for n8n cloud. If you're on cloud n8n, this workflow won't work as-is — you'd need to adapt it to use HTTP Request nodes with SurrealDB's REST API instead. I'm self-hosting, so the community node was the path of least resistance.

## The Graph Model

The database has four tables: `track`, `album`, `playlist`, `artist`, connected by graph edges. The schema is dead simple:

- `(artist)-[:released]->(album)`
- `(album)-[:includes]->(track)`
- `(playlist)-[:playlist_track]->(track)`
- `(user)-[:likes_track]->(track)`

![Database design screenshot showing tables and relation edges](https://u.macula.link/gH6WZ7Y4SruO2InnawnZNg-7?preset=sys_md)

The beauty of this model is that it maps directly to the Spotify API responses. A playlist endpoint returns an array of `{ track: { album: { ... }, artists: [...] } }` — I flatten that into records and edges. Each track gets one UPSERT, each album gets one UPSERT, and the edge between them is a simple relation query. No denormalization, no duplication.

## Four Sync Flows

The workflow has four sub-flows, each triggered on a schedule. They're designed to be independent. One failing doesn't block the others.

**1. Following artists.** Smallest and simplest. Fetch the list of artists I follow, UPSERT each one into the `artist` table. Runs every few hours since this list rarely changes.

**2. Playlists.** Fetch all playlists in my library, UPSERT each into the `playlist` table. Straightforward until a playlist gets deleted — then I need to detect that and mark it inactive. Currently I just let stale records sit there. I should clean those up.

**3. Liked tracks.** Fetch my saved tracks from the "Liked Songs" endpoint (Spotify calls it the library). For each track, UPSERT the track record, extract the album, UPSERT the album, and create the `likes_track` edge from my user node to the track node.

**4. Playlist tracks.** This is the big one. The flow loops over every playlist, then loops over every track in each playlist. Here's where it gets gnarly.

Spotify paginates playlist tracks at 50 per page. Some of my playlists have over 1,000 tracks. So the first thing this flow does is fetch the first page, count the total, then loop until it's pulled everything.

For each track in each page, the flow needs to:

- UPSERT the track record (title, artist reference, duration, Spotify URI)
- Extract the album reference from the track payload
- UPSERT the album record (title, release date, cover art URL)
- Create or verify the `released` edge from artist to album
- Create the `playlist_track` edge connecting the playlist to the track

That's up to five database operations per track. For a playlist with 1,200 tracks, that's 6,000 operations. The whole sync processes about 27,000 tracks across all playlists, so the total operation count is well into six figures. This is where UPSERT earns its keep — without it, every operation would need a pre-check for existing records.

The flow also caches playlist checkpoints. If a playlist hasn't changed since the last sync (based on the `snapshot_id` Spotify returns), it skips that playlist entirely. This cut the average sync time by about 60%.

## Four Things That Broke

Every integration project has its list of "I cannot believe this is the problem." Here are mine.

### 1. n8n node output mutation

After a SurrealDB node runs, the upstream Spotify node outputs lose their `id` field. The SurrealDB community node returns records with an `id` field that's a SurrealDB record ID object (like `track:abc123`), while Spotify's `id` is a plain string. Somewhere in n8n's internal output merging, the string `id` gets overwritten or dropped.

**Workaround:** Insert a Code Node between the Spotify call and the SurrealDB node. The code node copies the Spotify `id` into a differently-named field (I call it `artistsId`) that neither node touches. The SurrealDB node writes its own `id` separately, and everyone stays happy.

This pattern repeats throughout the workflow. Anywhere you see a Code Node doing a field copy, that's why.

### 2. SurrealDB datetime in relations

SurrealDB lets you define a field as `datetime` on a table. But when you create a graph edge relation using the community node's "create relation" action, it serializes all fields as JSON strings. A datetime value becomes `"2026-05-06T12:00:00Z"`, a string instead of a datetime. SurrealDB rejects that at the schema level.

**Workaround:** Skip the "create relation" action entirely. Use a raw SurrealDB Query Node with the `RELATE` statement instead:

```sql
RELATE $playlist_id->playlist_track->$track_id SET added_at = $added_at
```

The Query Node sends the SQL directly, so SurrealDB's parser handles the datetime properly.

### 3. The retry count bug

The SurrealDB Query Node has a Retry Count setting. I set it to `0`. Why retry an idempotent UPSERT? It ignored me. The node hardcodes a default of 4 retries and doesn't respect a `0` override. Every UPSERT that hits an existing record (which is most of them on subsequent runs) retries 4 times before succeeding.

The impact is brutal. Creating 30,000 relations takes 4x longer than it should because each one is a no-op that retries four times.

**Workaround:** Mark relation errors as "continue on error" on the node. The UPSERT still retries internally, but the workflow doesn't halt. The duplicate records are harmless because the relation already exists. It's wasteful, not broken. I plan to submit a PR to fix the hardcoded retry.

### 4. Spotify's null track

There's a playlist in my library called [`must know`](https://open.spotify.com/playlist/4DbKOVVmWllXWpCmGLWCjR?si=26854f33abd04e77). In the Spotify app it shows 133 songs. The API returns 134 items. One of them has `track: null`.

![Spotify API response showing a null track field](https://u.macula.link/PsdqFcn-SkOy8bAMpdKIUw-7?preset=sys_md)

This happens when a track gets deleted from Spotify or becomes unavailable in your region. The playlist entry still exists, it counts toward the total, but the track reference is gone. The API doesn't filter these out. It just gives you `null` and lets you figure it out.

**Workaround:** Filter out items where `item.track` is null before processing. One line in a Code Node at the start of the loop.

## Live Queries

Once the data is in SurrealDB, there's a feature I keep coming back to: live queries. You can subscribe to a table and get pushed updates when anything changes. It's SurrealDB's version of a real-time listener, built into the database layer instead of bolted on with WebSockets.

```sql
LIVE SELECT * FROM playlist_track;
LIVE SELECT * FROM track WHERE artist = $artist_id;
```

Switch the Surrealist query tab to "Live" mode and results stream in as records change. I use this to watch the sync happen in real time during development. Handy for catching runaway loops.

(Metrics for live queries are only available in SurrealDB Cloud, not the desktop Surrealist app, in case you go looking for them.)

## Stats

15 years of music history weighs about 93MB in SurrealDB. That's pure metadata — track names, artist IDs, album references, relation edges. No audio files. Passports for every song, not the bags.

| Type        | Count  |
| ----------- | ------ |
| tracks      | 27,009 |
| albums      | 17,563 |
| playlists   | 126    |
| liked songs | 1,580  |

## Try It

The complete n8n workflow JSON is at **[`/files/spotify-workflow.json`](/files/spotify-workflow.json)**. Download it, open it in a text editor, and replace the placeholder credential IDs with your own:

- `surrealdb-cred-id` — your SurrealDB credential ID (visible in the n8n URL when editing the credential)
- `spotify-cred-id` — your Spotify OAuth credential ID (same deal)

Then import the JSON into n8n (create a new workflow, paste the JSON). The credentials section of the frontmatter in this post also lists these if you're reading the source.

I'd love to see what integrations other people are building with this pattern. [Open a GitHub issue](https://github.com/woss/woss.io/issues) or tag me — what's the next sync you want to build?
