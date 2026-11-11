---
published: true
title: "We ran ten AI critics over the SEAL spec, then six debunkers. Here's what survived."
slug: 'seal-spec-ai-critique'
description: 'How we machine-critiqued the SEAL specification with a three-stage LLM pipeline: ten independent critics, 48 deduplicated proposals, six adversarial refuters instructed to kill them. What survived review, what the AI got wrong, and full disclosure of the models and method.'
date: 2026-11-11
tags:
  - AI
  - LLM
  - Security
  - SEAL
featured: false
part_of_series: 'sealing-media'
---

A few weeks ago I needed to sign files with SEAL, Neal Krawetz's Secure Evidence Attribution Label. If you haven't seen it: it's DKIM for media. You sign a hash of some byte ranges of a file, you drop a small `<seal ... />` record into the file (or a sidecar), and you publish your public key in a DNS TXT record. Anyone can verify the file came from your domain without a central registry, a blockchain, or a plugin. For a company like ours whose whole product is provable provenance for images, it's a very good fit.

There was one problem. SEAL has a C implementation (`sealtool`) and a browser-only JavaScript validator (SEAL-JS), but nobody had written a signer in JavaScript. Our stack is TypeScript end to end, so I wrote one. As far as I know it's the first full JavaScript signer for SEAL, and it's going up as `woss/seal-ts` on npm.

Writing a signer against a spec is a different activity from reading a spec. Every sentence either compiles or it doesn't, and when two sentences disagree, your test suite finds the disagreement for you, usually at 1am. Ours found several. At some point it was obvious the spec itself needed a hostile read, and I'd been meaning to test a workflow for exactly this kind of job. So we built one.

## The pipeline

The whole thing ran on GLM (glm-5.3-flash, Z.ai's model), orchestrated by omp, an agent harness that lets one orchestrator spawn subagents and collect their results. Seventeen agent runs, three stages.

**Stage 1: ten critics, ten lenses.** I fetched the four files that make up the spec (SPECIFICATION, SECURITY_CONSIDERATIONS, FORMATS, COMPARISON) to disk so every agent read identical bytes. Then ten read-only agents, each with one assignment: cryptography and algorithm agility; the DNS trust model; revocation and time; record grammar; byte ranges and the preimage; the format annex; versioning and extensibility; privacy; security-considerations completeness; conformance. Independent means independent: they didn't see each other's output. They came back with 71 findings.

**Stage 2: dedupe.** One agent merged the 71 into numbered proposals with line anchors. It reported 49. There are 48 headers in the document. I counted by hand after the fact and caught the miscount, which is its own data point about trusting agent self-reports.

**Stage 3: six debunkers.** This is the stage that earned its keep. Six agents, eight proposals each, one instruction: _kill these_. Verify every line anchor against the spec text. Check every implementation claim against our vendored copy of the reference validator. Find the misreading, the overclaim, the citation that doesn't exist. Verdicts came back: 19 confirmed, 23 weakened (each kept only the part that survived), 6 dead.

## What the AI got wrong (the part I care most about)

One proposal claimed the spec says a missing `uid=` defaults to `uid=1`. No such text exists anywhere in the four files. The refuter grepped, found nothing, traced the error (the model had conflated the default of a different field, `kv=1`), and killed the proposal with a citation showing both real passages say the opposite of the claim. A fabricated quote, caught by another instance of the same model, twenty minutes later.

That's the honest summary of LLM reliability here. 12.5% of the proposals were outright wrong (6 of 48), roughly half the rest were overstated in ways that needed trimming, and one proposal was _understated_: the refuter found the revocation-date text (SPEC:611) contradicts itself inside a single sentence, which is worse than what the critic had claimed. Without the adversarial pass we'd have sent Neal a document that was about 40% wrong. With it, we sent one where every surviving claim has been re-verified against spec text by an agent specifically instructed to destroy it, and where the six deaths are documented so he can check our work.

The other thing worth saying: the miscounted "49 proposals" never made it into the final document, because the final count was done against headers, not against the synthesizer's confidence. Trust structure, not vibes.

## What survived (the findings, in plain language)

The full document with every line anchor is going to Neal; here's the readable version of the parts that survived adversarial review.

**Revocation is order-dependent.** The spec says, in one place, that revocation happens if a revoked record _exists_ that matches, and in another that status comes from the _first_ record that matches. With two live records for the same key (a completely normal state: key record plus a `r=revoke` copy during rotation), whoever controls the DNS answer order controls whether your signature reads VALID or REVOKED. The reference validator implements the first-match reading, so the attack needs no key material at all. Just reordering.

**Read literally, every inline key is revoked.** The spec says a DNS record with no `p=` field is "explicitly invalid due to revocation." It also says inline-key records, the mechanism for people without their own domain, must not have a `p=` field. Both rules are in the same document. The reference validator reads it the merciful way, which is how I know the text and the implementations have drifted apart.

**Date comparisons are done lexically, in production.** The spec blesses three revocation-date formats and never defines how to compare them to a signature timestamp. The reference validator compares them as strings. So `2024032616…` (compact, blessed) versus `2024-04-03` (ISO-ish, also blessed): character three of the first string is `4`, character three of the second is `-`, and `4` sorts after `-`, so the signature reads as revoked even though it predates the revocation. A month of wrong verdicts, from a punctuation sort order.

**A mailed DNS record gets full attribution.** The spec allows a validator to use a locally copied DNS record "in place of an active DNS lookup." Combined with the definition of `Valid` (attribution "via DNS association"), that means an attacker can email you their key wrapped in a record that says `example.com`, you validate offline, and the file comes back fully attributed to example.com. Meanwhile the spec's own inline-key rule says an inline key "does not authenticate the signer" and files those as Unattributable. The offline copy is the same trust level with better PR.

**The spec mandates an algorithm browsers cannot run.** `da=sha224` is in the digest table. WebCrypto, the crypto API in every browser and in Node, has no SHA-224. Any validator built on WebCrypto cannot verify a record the spec tells it to support. There's no registry of algorithms and no "unsupported" outcome state, so one validator says Unverifiable and another says Tampered, and nothing in the spec tells you which is right.

**There's no "Unsigned" state.** Nine outcome states, and not one of them means "this file has no SEAL record." Stripping a signature is the cheapest attack there is, and it produces the same validator output as a corrupt signature. For a format explicitly aimed at legal evidence, being unable to distinguish "never signed" from "signature broken" is a real gap.

**RSA is never specified.** The spec says "encrypt the digest" and "decrypt the signature," which is not how modern RSA signatures work, and the words PKCS, PSS, and DER appear nowhere. Our validator port had to guess RSASSA-PKCS1-v1_5. Any independent implementation guessing differently produces byte-incompatible signatures. That's not an edge case; that's the main case.

**The format annex has a rough week.** The Matroska section specifies 5-byte EBML identifiers (EBML tops out at 4) and claims one of them "spells SEAL". The hex actually spells `0x05` followed by `4TAL`, because S (0x53) got mis-hexed as 0x34 somewhere along the way. The PNG section describes the chunk name `seAl` as "public" when, per PNG's own bit rules stated correctly two files later, the lowercase second letter makes it _private_. tar is described as having an archive comment field; tar has no archive comment field. And the JPEG table calls APP14 "0xfffe," which is the COM marker. All four survived refutation because they're checkable facts.

**And the root cause finding: there are no test vectors.** No RFC 2119 statement (MUST and "should" mix within single lists), no conformance section, no byte-exact examples for any recommended flow. That's why nine internal contradictions and twelve undefined behaviors could coexist with two working implementations: each implementation resolves the ambiguities its own way and the spec never has to notice. Our fix list starts there: conformance appendix, one CI-validated worked example per flow, and an IANA-style algorithm registry.

## What we're asking Neal for

The short version, all detail in the doc: name the RSA scheme and the ECDSA encoding; pick one canonical PNG `b=` example (the current two contradict); make revocation order-independent and define a single canonical `r=` date format; add an `Unsigned` state and an `Unsupported`-algorithm state; fix the four format-annex bugs; decide the offline-key question (either require live DNS or give pinned keys their own outcome); and add test vectors, because every other fix is unenforceable without them.

None of this says SEAL is a bad format. It's a good format with a spec written by one person faster than one person can cross-check themselves. Every spec I've ever worked on has this class of bug, including ones with committees. The goal of the doc is to make the next implementer's 1am shorter.

## Disclosure

Full transparency on who did what, since the method was the experiment.

The research pipeline was LLM-driven: GLM (glm-5.3-flash) served through opencode-zen, orchestrated by omp, seventeen agent runs across the three stages, a couple dollars of inference time. The orchestrator fetched the spec files to disk, split the lenses, ran the dedupe, and ran the refutation batches. Refuters were explicitly instructed to try to kill the work, and their verdicts (including the kills) are all in the final document.

I'm the one who decided the findings mattered, set the pipeline up, caught the 49-versus-48 miscount by counting headers, and spot-checked the headline findings by hand: the lexical date compare, the inline-key contradiction, and the `4TAL` hex. I own this post. The spec-feedback document itself carries every line anchor so Neal can verify or correct each item in minutes; corrections will flow straight into our signer's docs.

If you're implementing SEAL, or thinking about media provenance generally, I'd like to compare notes. And Neal: thanks for building the thing. The feedback doc is coming your way.

## Links

- SEAL (Secure Evidence Attribution Label), by Neal Krawetz: [github.com/hackerfactor/SEAL](https://github.com/hackerfactor/SEAL)
- SEAL-JS, the browser-only JavaScript validator: [github.com/hackerfactor/SEAL-JS](https://github.com/hackerfactor/SEAL-JS)
- seal-ts, our TypeScript signer: [github.com/woss/seal-ts](https://github.com/woss/seal-ts)
