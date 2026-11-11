---
published: true
title: "No tokens: publishing seal-ts to npm and JSR with OIDC, and the bot that couldn't pass the door"
slug: 'seal-ts-trusted-publishing'
description: 'How we shipped @woss/seal-ts to npm and JSR without a single registry token: npm trusted publishers, JSR scope authorization, release-please, and the github-actions[bot] actor problem that broke both registries and how the pipeline now avoids it for good. Also the honest inventory of the C-to-TypeScript port.'
date: 2026-11-11
tags:
  - SEAL
  - npm
  - JSR
  - release-please
  - CI/CD
  - TypeScript
featured: false
part_of_series: 'seal-spec-ai-critique'
---

This morning I wrote about [running ten AI critics over the SEAL specification](/seal-spec-ai-critique). The post ended by saying the TypeScript signer is "going up as `woss/seal-ts` on npm." That was optimistic phrasing for a package that, at the time, existed as a directory inside our private monorepo with no repository, no CI, no docs, and no npm presence at all.

By evening it was real: [github.com/woss/seal-ts](https://github.com/woss/seal-ts) is public, [the docs are on GitHub Pages](https://woss.github.io/seal-ts/), and version 0.2.0 is live on both [npm](https://www.npmjs.com/package/@woss/seal-ts) and [JSR](https://jsr.io/@woss/seal-ts), published by CI with signed provenance and not a single long-lived registry token anywhere in the setup.

The publishing part took longer than the package part, and most of the delay was two failure modes I hadn't seen written up anywhere. So this is that story. If you're wiring up trusted publishing with release-please, the two sections about actors will save you an afternoon.

## The package

Quick summary of what shipped, since the details matter for the publishing story. SEAL is Neal Krawetz's media-provenance format: a DKIM-style `<seal ... />` record embedded in a JPEG or PNG or text file, public key in DNS TXT. Upstream has a C signer and a browser-only validator; the TypeScript signer is ours, and it's what the Kelp product uses to sign images. Extracting it from the monorepo meant standing it up as a real standalone project: rslib build with structure-preserving emit and per-file declarations, vitest at 100% coverage thresholds (the vendored validator is byte-pinned to upstream and excluded), ESLint, and a CI matrix that now runs the test suite on Node, Deno, and Bun.

The last one is worth a paragraph because it changed the code. To support browsers honestly — not "works if your bundler polyfills node:buffer," actually works — the signer can't touch `Buffer`. The old base64 helpers used it in three places. They now use the ES2026 `Uint8Array` base64 and hex methods (`toBase64`, `fromBase64`, `toHex`), which are shipped in Node 24+, Deno, Bun, Chrome, Safari, and Firefox. TypeScript 5.8 doesn't type them yet, so there's a small ambient declaration file in the repo with a comment saying to delete it at the next TypeScript bump. We also considered pulling in noble for the encodings, but noble v2 removed base64 from its utils, and hex alone doesn't justify a dependency. The platform grew the right primitive; we just had to accept that it's new.

## The port: what moved from C, what didn't

The signer has exactly one reference implementation: Neal's `sealtool` in C, built on OpenSSL. Our version is TypeScript built on WebCrypto. Porting between those two stacks is where all the interesting differences live, so here's the honest inventory.

**The verify side is not a port at all.** SEAL-JS already exists as a browser validator, so instead of translating C verify logic into TypeScript, we vendor SEAL-JS into the package verbatim, byte-pinned to an upstream commit (a test hashes the file and fails if anyone edits it). This is the one decision I'd defend hardest: verify-side compatibility with the ecosystem is guaranteed by construction, not by test coverage. A port can be bug-for-bug identical; a vendored copy is identical, full stop.

**The sign side is a real port, and the crypto stack changes everything.** sealtool signs with OpenSSL's EVP API: synchronous calls, keys as PEM files on disk, and OpenSSL quietly picking signature parameters from the key type. WebCrypto is a different animal. Every operation returns a Promise, keys are opaque `CryptoKey` objects, and the API forces you to name the exact signature scheme up front. That last one matters because the SEAL spec never names one. It says RSA signatures are "the signature encrypted" and never uses the words PKCS, PSS, or DER. WebCrypto can't not choose, so we chose RSASSA-PKCS1-v1_5 with SHA-256, then proved the choice by round-tripping: sign with our code, verify with the vendored validator, byte for byte.

Two more places the stacks disagree, both fixed in a few lines and both worth knowing if you implement SEAL yourself:

- **ECDSA signatures come out of WebCrypto as raw P1363** (64 bytes of r||s), but the validator expects DER encoding (a nested TLV structure). The fix is a 20-line converter. The C tool never deals with this because OpenSSL emits DER natively.
- **WebCrypto has no SHA-224.** The spec's digest table blesses it; the browser API cannot compute it. Any `da=sha224` record is unverifiable in a browser, forever. That's a spec bug we flagged in the critique post, and the port is where it becomes concrete.

**What carried over unchanged:** the record grammar, the container formats (JPEG APP8 segment with the `SEAL\0` label, PNG `seAl` chunk, plain append for text), and the preimage: the same SHA-256 over the same selected byte ranges. And crucially, keys are interchangeable. A keypair generated by `sealtool` publishes to DNS and our signer consumes it, and vice versa; the `p=` field is just base64 SPKI either way. At the wire level there is one SEAL, whatever language signs it.

**What we deliberately didn't port:** sealtool's remote-signing mode (signing a file that lives at a URL) and its long list of supported hash algorithms. Our signer does SHA-256 and local buffers, which is everything the Kelp pipeline needs. Skipping them kept the public API at eight exports, and eight exports is a surface you can actually document.

## The registry plan

Both npm and JSR now support trusted publishing: you register your repository and workflow filename with the registry, and CI authenticates with an OIDC token minted by GitHub Actions. No `NPM_TOKEN` secret. No JSR API key. No token rotation calendar entry. npm additionally signs a provenance statement into the sigstore transparency log, so anyone can verify the tarball was built by this repo's workflow and not uploaded from a maintainer's laptop.

That last clause, as it turned out, was doing more work than I expected. Keep reading.

The release flow is the standard release-please setup: commits following Conventional Commits (`feat:`, `fix:`, `chore:`) drive a version bump; release-please maintains a release PR with the changelog and version bumps; merging that PR tags the repo and fires the publish workflow. We copied the shape from our exiftool-ts repo, which has run this way for a while.

## Failure one: the manifest

First red run, thirty seconds after the workflows merged: `release-please failed: Missing required manifest versions: .release-please-manifest.json`. The manifest is a three-line JSON file pinning the current version; release-please diffs against it. Our exiftool-ts repo has one. When I ported the workflow, I ported the config and forgot the manifest. Three lines, fixed.

## Failure two: the permission nobody mentions

Second red run: `GitHub Actions is not permitted to create or approve pull requests`. release-please's whole job is opening PRs, and on new repos the default workflow permissions forbid that. The setting is buried in repo Settings → Actions, and — usefully — it's settable over the REST API without clicking through the UI: `PUT /repos/{owner}/{repo}/actions/permissions/workflow` with `can_approve_pull_request_reviews=true`. Rerun, and the release PR appeared.

Then came the one that taught me something about squash merges. I'd pushed the manifest fix to the PR branch *after* the release PR had already been squash-merged. Squash means `main` got one new commit containing the branch's changes as of merge time; my later commit was stranded on a branch that no longer pointed anywhere meaningful. The fix: re-land it as its own tiny PR. Lesson: with squash merges, pushing follow-up commits to a merged branch is writing into the void.

## Failure three: npm's first publish

Here's the chicken-and-egg that the npm docs don't spell out. Trusted publishing authorizes a workflow against a *package*. But the package doesn't exist until the first publish. PyPI handles this with a "pending publisher" you can register before the first upload. npm has no equivalent (there's an open npm/documentation issue about exactly this, #1926). The first publish has to be manual, from an authenticated npm account. After that, every publish goes through OIDC.

So: one manual `npm publish` for 0.1.0. And one wrinkle that cost me a confusing 403 later — npm trusted publisher connections have an "allowed actions" checkbox, and a connection configured with only "npm stage publish" will reject real publishes with `OIDC permission denied for this action`, which is not a message that points at the checkbox. Delete the connection, re-add it with "npm publish" allowed, and CI publishes work. The "pending validation" state on the connection page clears after the first successful CI publish.

## Failure four: the bot that could never pass

This is the one worth the price of admission.

After merging the 0.1.0 release PR, a workflow fired and failed. I reran it. Failed. Reran again. Failed identically: JSR rejected the publish with `actorNotScopeMember — the actor that this request was authenticated for is not authorized as a scope member for this scope`.

The confusing part: I had linked the repo on JSR, authorized Actions publishing, claimed the scope. Everything the setup page asked for. The registry still said no.

The OIDC token embedded in a GitHub Actions run carries an `actor` claim: the identity that triggered the run. When *you* push a tag or dispatch a workflow, the actor is you, and JSR checks you against the scope's members. But when *release-please* creates the tag, the tag-push event is triggered by `github-actions[bot]`. The publish workflow then mints an OIDC token whose actor is a bot account that by definition can never be a member of your scope. JSR rejects it. Forever. Rerunning doesn't help because every rerun inherits the same triggering actor. And npm's OIDC path rejects bot actors the same way.

The fix that worked: dispatch the publish workflow manually, as a human.

```sh
gh workflow run release.yml -f tag_name=v0.1.0
```

Same workflow, same tag, but the OIDC token now says `actor: woss`, and JSR waves it through. 0.2.0 published on the first try this way.

There's a cleaner fix than dispatching by hand, and it's now in the repo. release-please supports running with a fine-grained personal access token instead of `GITHUB_TOKEN`. The PAT belongs to me, so the tag it pushes carries *my* actor, so the tag-push publish runs as a human. Merge the release PR, tag fires, both registries publish, done. The only manual step left in a release is merging the release PR — which is a feature, not a bug: a human decides what ships.

So the setup that works, for the record:

- release-please runs with a PAT that has contents and PR write on this one repo
- its release PR carries the changelog and version bumps for `package.json` and `jsr.json`
- merging it pushes the tag as a human, which fires the publish workflow as a human
- the publish workflow runs lint, typecheck, tests, and build as gates, then publishes to npm (`--provenance`) and JSR (`npx jsr publish`) under `id-token: write`
- no registry tokens in GitHub secrets, ever

## The bootstrap wrinkle

One more, smaller, and worth knowing: release-please version-bumps by parsing commit history. Our repo's history was "Add README," "Initial package import," and a merge commit — none conventional. So the first run cheerfully reported `Considering: 0 commits` and proposed nothing. If you're adopting release-please on an existing repo, your first release needs a bootstrap: any commit with a conventional prefix (`chore: bootstrap seal-ts package`) so there's something to version.

## What it's like now

The whole loop, post-mortem complete: push features as PRs with conventional commits. When there's enough for a release, release-please opens (or updates) the release PR. Merge it. The tag fires. npm and JSR both publish with provenance; the GitHub release gets the tarball and notes attached; Pages redeploys if docs changed. I have merged three releases this way today and the third one I did from my phone.

Was JSR worth adding alongside npm? For a TypeScript-first package, yes, and not just for the extra distribution. JSR's publish step type-checks your public API and refuses slow types, which pushed us to document every exported symbol before 0.1.0 rather than someday. The docs score it computes is a nice nudge, but the type-coverage gate is the real product.

The package itself: [woss/seal-ts](https://github.com/woss/seal-ts), MIT, zero runtime dependencies, signer and byte-pinned validator, [docs](https://woss.github.io/seal-ts/) including the TypeDoc API reference. If you're implementing SEAL, the [spec critique post](/seal-spec-ai-critique) pairs with this one — that's the what and why, this is the how it shipped.

And if you're about to set up trusted publishing: check the actor claim before you check anything else. `gh api repos/{owner}/{repo}/actions/runs/{run_id}` and look at `triggering_actor`. If it says `github-actions[bot]`, no amount of registry configuration will help. Rerun as yourself, then fix the pipeline so it never happens again.

## Links

- seal-ts, the package: [github.com/woss/seal-ts](https://github.com/woss/seal-ts) · [npm](https://www.npmjs.com/package/@woss/seal-ts) · [JSR](https://jsr.io/@woss/seal-ts) · [docs](https://woss.github.io/seal-ts/)
- npm trusted publishers: [docs.npmjs.com/trusted-publishers](https://docs.npmjs.com/trusted-publishers)
- The missing-first-publish-docs issue: [npm/documentation#1926](https://github.com/npm/documentation/issues/1926)
- release-please: [github.com/googleapis/release-please](https://github.com/googleapis/release-please)
- SEAL, by Neal Krawetz: [github.com/hackerfactor/SEAL](https://github.com/hackerfactor/SEAL)
- Previous post: [We ran ten AI critics over the SEAL spec](/seal-spec-ai-critique)
