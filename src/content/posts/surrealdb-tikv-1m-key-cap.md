---
published: true
title: 'SurrealDB on TiKV: the 1M-key cap that broke a deploy, and the two-day dig that fixed it'
slug: 'surrealdb-tikv-1m-key-cap'
description: 'A production incident story: a routine deploy pinned by an already-dead table, an error message that pointed at the wrong layer, and two days in the SurrealDB source to find out who actually owns the 1M-key limit, why raising it is not enough, and how to drain 205k rows without OOMing the database.'
date: 2026-11-08
tags:
  - SurrealDB
  - TiKV
  - Kubernetes
  - Databases
  - Incident
featured: false
---

I thought SurrealDB had a bug in its transaction layer.

The error said `Transaction range operation exceeded the maximum key count of 1000000`. It showed up mid-migration, out of an init container that had been retrying for over an hour, and my deploy was pinned behind it doing nothing. My first two theories were both wrong. I spent the next two days inside SurrealDB's source, a Hetzner Kubernetes cluster, and a dead job queue, and came out the other side knowing exactly who owns that 1M-key number, why raising it doesn't fix anything on its own, and how to actually delete a couple hundred thousand rows without taking the database down with them.

## The table that was already dead

kelp-market, the decentralized content-licensing platform I work on, runs SurrealDB 3.2.4 on TiKV (three PD nodes, three TiKV nodes) on a kube-hetzner cluster. Schema migrations run inside `surreal-schema` init containers, gated by a lease so only one applier can mutate schema at a time. It's careful design. This incident found the weak spot anyway.

The deploy hung at "Apply prod overlay". The pods sat at `Init:2/3`, both Datadog init containers done, the third one (surreal-schema) spinning. Its log was the same two lines over and over:

```
Waiting for schema lease (attempt 50/300; holder ? until ?)
Baseline already present — skipping init.surql replay
Schema apply failed (attempt 1/40), retrying in 831ms:
  ValidationError: There was a problem with the key-value store:
  Transaction range operation exceeded the maximum key count of 1000000
```

The failing step was migration 0014, `job_queue_to_analytics`, and its last line is `REMOVE TABLE job_queue`. By that point the table was a corpse. The job queue had cut over to a Postgres-backed queue on October 31, and 0014 exists to sweep up the leftovers. It held 205,000 records, which sounds manageable until you learn that in Surreal's storage layout, one record is never one key.

## Two wrong theories

The error text is honest, but it points at the wrong layer. "There was a problem with the key-value store" reads like TiKV refusing the transaction, and I ran with that in two directions at once.

First: TiKV must have a hard native limit on transaction size, so the answer is some TiKV config, or a version bump. I checked. Neither exposes the knob, because the knob isn't theirs.

Second: the storage tier must be wrong for us at this scale, so the answer is architectural. I got a decent way into drafting a plan to migrate off TiKV before I did the thing I should have done first, which was read SurrealDB 3.2.4's TiKV backend.

## Reading the source

The guard isn't in TiKV. It's SurrealDB's own, and it lives in `core/src/kvs/tikv/cnf.rs`:

```ignore
/// Maximum number of key operations allowed in a single delr
/// (a transactional range delete). Configurable via env
/// `SURREAL_TIKV_DELR_MAX_KEYS`. Callers that need to drop very large
/// ranges either page the delete across committed transactions or, where
/// the backend offers it, use the out-of-transaction
/// [`crate::DestroyRange`] capability.
#[error("Transaction range operation exceeded the maximum key count of {0}")]
TransactionRangeTooLarge(u32),
```

Default `delr_max_keys: 1_000_000`, overridable through an environment variable. The first fix for the deploy was one line on the surrealdb container:

```text
SURREAL_TIKV_DELR_MAX_KEYS=4000000
```

With the code in front of me, a few things I'd been getting backwards fell into place.

TiKV has no per-transaction 1M-key wall, at least not one we hit. This guard belongs to SurrealDB, defined per backend, and SurrealKV, Surreal's single-node store, doesn't have one at all because it has no distributed transaction to protect.

The count is in keys, not rows. A row costs the record itself, one entry per defined index, plus internal MVCC bookkeeping. Our 205,000-row table was a keyspace of well over a million keys, which is why something "small" blew the cap.

And raising the cap was not enough on its own. A big `REMOVE TABLE` compiles down to a whole-keyspace sweep, and that sweep materializes MVCC versions in RAM. At a 10Gi memory limit the pod got OOM-killed mid-sweep, over and over. The env var moves one wall. The memory wall stays up until you drain first, or bring more RAM.

## The drain

Everything else I tried either failed outright or crawled, so I'm writing all of it down. This is the part I went looking for on the internet and didn't find.

**Chunked `DELETE tbl WHERE id IN $ids`, 500 to 5000 ids per round.** It works, at roughly 3k rows a minute. Slow. It also hides a trap that cost me a morning: the ids have to be raw record-id objects. Hand over strings like `"job_queue:abc"` and Surreal matches zero records. No error, either. The DELETE reports success and deletes nothing.

**Whole-table `DELETE` or `REMOVE TABLE` under the raised cap.** At 10Gi: OOM. At 30Gi it completes, but the memory profile while it runs is terrifying.

**Filtered deletes, `WHERE createdAt < …` or id-range predicates.** Timeout at two minutes. Every single time.

**What actually worked: single-record deletes over the HTTP SQL endpoint, in parallel.** `DELETE job_queue:<ulid>`, one record per statement, 64 statements per POST body, 32 POSTs in flight. Per-record cost sat flat at 60 to 70 milliseconds, and 32-way parallelism held about 186 rows a second while SurrealDB used three cores and under 1Gi. 138k rows in about 12 minutes, exact count deltas, nothing dropped.

The HTTP endpoint wasn't a stylistic choice. SurrealDB 3.2.4's WebSocket RPC kills your session after any single statement that runs longer than about 25 seconds. No error, nothing you'd catch from the client. The next statement just gets sent into a session that's already dead. My 5000-row deletes and my whole-table deletes kept "hanging" because the transport was dying mid-statement, not because the database was slow. HTTP `/sql` has no such guard. It handled 30-second reads and multi-statement POSTs all day.

```js
// The shape that worked (Node, inside a kubectl exec target pod)
const data = Buffer.from(stmts.join(';\n'));
const rq = http.request({
  hostname: 'surrealdb', port: 8000, path: '/sql', method: 'POST',
  headers: {
    'Accept': 'application/json', 'Content-Type': 'text/plain',
    'Content-Length': data.length,
    'Authorization': 'Basic ' + b64,
    'Surreal-NS': ns, 'Surreal-DB': db,
  },
  timeout: 300e3,
});
```

## Tombstones: the second memory wall

While the drain ran, the surrealdb pod showed a signature I didn't trust. Pegged at 3.4 cores, memory swinging between 0.8 and 8.8Gi. The engine logs looked healthy otherwise: no lock storms, no region errors, MVCC GC doing its pass every ten minutes. Meanwhile foreground scans kept OOMing, and the restart count climbed from 4 to 9 to 10 over the course of the incident.

I only understood it after the drain finished. Emptying a table doesn't remove its history. The drained keyspace was still carrying around a million MVCC tombstones left by the drain itself, and any scan over that keyspace, including the final `REMOVE TABLE`, has to materialize them in-process. So I raised the pod's memory limit to 30Gi in the infra repo and let the final sweep run once with that headroom. It went through. Once the tombstone window passed, memory settled back to about 26Mi at idle.

Nobody warns you about this part. Draining a keyspace leaves a debt behind, and the next sweep pays it in RAM.

## Taking the lease myself

While the drain was in flight, the wedged init containers kept cycling. Every attempt re-ran the doomed migration and fought me for the same key range. The init driver holds a lease, `schema_lock:global`, across its work, and that lease is just a row. Same conditional-UPSERT protocol, 60-second TTL, heartbeat renewals. So I took it myself.

With the lease held, the init containers settled into "Waiting for schema lease", which is a harmless wait-state instead of a table walk every 40 seconds. I held it through the sweep, released it, then marked migration 0014 in the ledger by hand (`UPSERT schema_migration:0014_job_queue_to_analytics SET …`) so the next init pass would see the work as already done. Scaled web/mcp back up. At that point 0014's apply reduced to a trivial removal of an already-purged table, the init containers cleared, and the deploy went green.

One footnote from the stretches where I didn't hold the lease cleanly: token clobbers, race loops, `LEASE LOST` responses. Take it, hold it, release it. Don't fight the semaphore.

The useful mental model is that the schema driver isn't a consensus mechanism. It's a lease row, and you can write that row too. When a deploy wedges on a doomed migration, the protocol is addressable from the side.

## What I check before believing "the DB is fine"

Three checks earned a permanent spot in my runbook. `SELECT count()` over HTTP, twice, ten seconds apart, because the ws path can lie and any single count races the churn around it. `SELECT * FROM schema_migration ORDER BY appliedAt DESC`, to compare what the ledger believes has been applied against what actually has. And the pod's `restartCount` with the last termination reason from container status, because Surreal's OOM cycles leave a clear trail: `reason: OOMKilled` shows up even when probes pass between restarts.

## Where things ended up

- `SURREAL_TIKV_DELR_MAX_KEYS=4000000` and a 30Gi memory limit on prod SurrealDB, both in the infra repo, both verified live.
- `job_queue` is drained to zero, the table is removed, 0014 is marked. Deploy is green.
- The SurrealKV cutover is parked as a plan. I'll reopen it the next time DDL wedges on size, not this time.
- The growth-table worry, `classify_llm_call_stats` and the audit streams, stays on Postgres. The queue already lives there after the Graphile move, and append-heavy telemetry belongs there or in something columnar anyway. If we ever get near trillion-scale, that's a queue-plus-archive-plus-aggregate design no matter which row store sits under the transactional part of the stack.

## If I could do it again

Read the error's origin before you design around it. `TransactionRangeTooLarge` is a SurrealDB guard that happens to share a number with a limit I'd assumed belonged to TiKV.

Count in keys, not rows. Record, plus one per index, plus MVCC artifacts. The total gets big faster than you'd expect.

A drained table still isn't done. Tombstone debt is real, and the bill comes due in RAM at the next sweep.

When the ws transport won't cooperate, HTTP `/sql` will. Single-record deletes, 32-way parallel.

Pass strings to `DELETE tbl WHERE id IN` and it deletes nothing while telling you it succeeded. RecordId objects, always.

And one dead table can pin a whole deploy. The un-stick sequence that worked: drain, take the lease, mark the ledger, scale back up. In that order.
