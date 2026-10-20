---
published: true
title: 'exiftool-ts 0.7.1: now it writes'
slug: 'exiftool-0-7-1-writes'
featured: true
part_of_series: 'exiftool-in-typescript'
description: 'exiftool-ts 0.7.1 ships full metadata writing across 13 formats: EXIF, XMP, IPTC, ICC, plus C2PA reading for AI-generated images. What works, what refuses to work on purpose, why your RAW files get sidecars, and plugin presets that finally mean what they say.'
date: 2026-10-20
tags:
  - ExifTool
  - TypeScript
  - metadata
  - open source
audience: general
---

For two months this library had a strange shape. It could read metadata out of almost anything a camera or a phone produces, and it could write metadata into exactly four formats with a narrow tag set. Read everything, write some. This release cycle closed most of that gap: the writing surface went from four formats to thirteen, with the tag groups people actually reach for, and the point releases since tightened the API around it. It's on [npm](https://www.npmjs.com/package/@woss/exiftool) and [JSR](https://jsr.io/@woss/exiftool) now.

Usual caveat, third time running: early software, expect breaking changes before 1.0. But the shape of the library finally matches the pitch.

## TL;DR

- 0.7.1 writes metadata to JPEG, PNG, WebP, AVIF, GIF, TIFF, EXV, PBM, PGM, PPM, plus standalone EXIF, XMP and ICC writers. 988 tests across 55 files keep it honest.
- Tag groups covered: EXIF (IFD0, ExifIFD, GPS), XMP (lists, structs, deletes), IPTC-IIM, ICC profiles, PNG text chunks, JFIF comments. ExifTool-style group write modes, `_original` backups, mtime preservation.
- C2PA reading is in: Content Credentials on AI-generated images (JPEG APP11, PNG `caBX`) parse through a real JUMBF box parser and CBOR decoder.
- RAW and DNG files refuse in-place rewrites. You get a `.xmp` sidecar instead. This is deliberate and I'll defend it below.
- 0.7.0 splits the plugin presets: `MODERN_PLUGINS` is the five web formats, new `MODERN_RAW_PLUGINS` covers DNG/CR2/NEF-style RAW plus sidecars, and `ALL_PLUGINS` is actually all. One breaking change, flagged below.
- Merging to `main` releases the package automatically. npm, JSR and a GitHub release, no tagging by hand — 0.7.0 and 0.7.1 went out that way, unattended.

## The writing part

The API didn't change. If you wrote with 0.3.0, this is the same call:

```ts
const tool = new ExifTool();
await tool.write("photo.jpg", { Artist: "me", Copyright: "(c) me" });
```

What changed is what that call does now. The writer serializes EXIF structures directly: IFD0, the Exif sub-IFD, GPS. XMP handles lists, structs, and deletes, which sounds boring until you've tried to remove one `Subject` keyword from a bag of forty without disturbing the rest. IPTC-IIM and ICC profiles round it out, and PNG gets proper text chunk handling across `tEXt`, `iTXt` and the compressed `zTXt`.

Write modes follow exiftool's semantics: you can scope a tag to existing values only, creation only, or a whole group, the same idea as its write-mode flags. Deleted-then-recreated groups behave the way exiftool users expect, which is the bar I hold everything against.

By default the writer produces `photo.jpg_original` before touching anything, like exiftool does. Pass `overwriteOriginal` when you're sure, or `preserveTime` when something else is watching mtimes.

## Three presets, and now they mean different things

0.7.0 reworked the plugin presets, and one part of that is breaking. Ever since 0.3.0, `MODERN_PLUGINS` and `ALL_PLUGINS` were the same list wearing two names: every shipped parser, thirteen of them after the writing work grew the set. Each new format silently joined both lists, which is how "modern" came to include PPM.

The names promise things now:

```ts
import { MODERN_RAW_PLUGINS } from "@woss/exiftool/plugins";

const tool = new ExifTool({ plugins: MODERN_RAW_PLUGINS });
// RAW containers (DNG, CR2, NEF, ARW, ORF, RW2, …) plus .xmp sidecar support
```

| Preset | Contents |
|---|---|
| `MODERN_PLUGINS` | JPEG, GIF, PNG, WebP, AVIF — the five formats that make up ~91% of web image traffic per HTTP Archive's Web Almanac 2024 |
| `MODERN_RAW_PLUGINS` | the TIFF-family RAW containers plus the XMP parser for sidecar writes |
| `ALL_PLUGINS` | everything shipped, in detection order |

If you used `MODERN_PLUGINS` to read RAW files, that's the break: switch to `MODERN_RAW_PLUGINS` or `ALL_PLUGINS`. The default `new ExifTool()` still loads everything, lazily, so most code notices nothing.

## The RAW rule, or: which files this writer refuses to touch

Here's a decision that cost more test code than the rest of the writing work combined. RAW and DNG files do not get rewritten in place. Not "not yet". Refused, with an exception you have to opt into.

The reason: a RAW file's byte layout isn't just EXIF. It's image strips, previews, tiles, often makernotes with vendor-specific encryption and offsets that point into each other. Rewriting one IFD means every offset behind it can shift, and a bug doesn't produce a wrong tag, it produces a corrupted master file. Real exiftool threads are full of people who did this wrong with homegrown writers.

So the library classifies what it's looking at. Plain TIFF (no sub-IFDs, no strip data) rewrites in place. A DNG with raw data, previews and tiles throws `UnsupportedFormatError` with a message that tells you what to do instead:

```ts
await tool.writeSidecar("IMG_0001.CR2", { Rating: 5, Description: "keep" });
```

That writes `IMG_0001.CR2.xmp`, merging into an existing sidecar if one's there. Lightroom reads those sidecars natively, so the non-destructive workflow photographers already use is the one the library fits into. Writing into a RAW container itself is on the roadmap, but only once I can prove round-trip safety against exiftool's own diff, same as everything else here.

## C2PA: reading the AI paper trail

The other big addition is reading C2PA Content Credentials. If you haven't run into them yet, these are signed manifests baked into AI-generated images describing what made them: generator, model, edit history, hashes. They live in a JUMBF box structure with a CBOR payload, squeezed into a JPEG APP11 segment or a PNG `caBX` chunk.

There's now a real JUMBF parser and CBOR decoder in the library, and manifests flatten into ordinary tags:

```ts
const info = await tool.read("ai-image.jpeg");
// info.tags: JUMDType, Claim_generator, Actions*, Assertions*, Item1X5Chain, ...
```

I smoke-tested this against an actual AI-generated JPEG mid-development and got 25 manifest tags back: generator info, the action list, assertion hashes, the certificate chain. Same deal as the rest of the library — the values diff against real exiftool, so when C2PA support diverges, CI says so.

Not implemented: writing C2PA manifests or validating signatures. That's a [phased plan](https://github.com/woss/exiftool/blob/main/C2PA_PLAN.md); reading had to exist first.

## Housekeeping worth knowing

Two smaller things shipped alongside.

The library had zero runtime dependencies for its whole life until this cycle; the writing work adds one, `fflate`, for zlib compression on PNG writes. I weighed vendoring a deflate implementation against a 30 KB, dependency-free library and chose boring. The browser build still bundles clean.

Releases run themselves now, and I mean that in past tense. Merges to `main` go through [release-please](https://github.com/googleapis/release-please): conventional commits collect into a Release PR, and merging it publishes npm, JSR and a GitHub release in one shot. The last two versions went out exactly that way the day they landed — the bot opened its first release PR, I merged it, everything published, no tags touched by hand. Getting there took discovering GitHub's "Actions may not create pull requests" repo setting, a release-please flag that silently ignores its own jsonpath, and one moved tag. That's what shakedown cruises are for.

## What still doesn't work

Same honesty policy as always. MakerNotes writing doesn't exist — the six core vendors decode for reading, but writing camera-vendor tags is out. CR3 and RAF files don't open at all. PDF and video aren't started. IPTC and XMP are core coverage, not the full schema long tail. The [parity doc](https://woss.github.io/exiftool/parity/) lists all of it, including the live divergence register, and it's the source of truth: check it before betting a pipeline on a tag group.

Part one of the writing work shipped here (the merge commit says "part 1" because there's more coming). Makernotes are the wall worth climbing next.
