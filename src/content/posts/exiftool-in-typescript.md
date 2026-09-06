---
published: true
title: 'ExifTool, in TypeScript: no Perl sidecars, no untyped JSON'
slug: 'exiftool-in-typescript'
featured: true
description: 'We rewrote ExifTool in TypeScript: typed reads and writes, zero runtime dependencies, a drop-in CLI, and a parity suite that diffs against the real exiftool binary on every build. Early development — what works, what does not, and why.'
date: 2026-09-06
tags:
  - ExifTool
  - metadata
  - CLI tools
  - open source
  - AI-assisted development
audience: general
---

@woss/exiftool is in early development. Expect breaking changes and rough edges on the way to 1.0. Don't point production pipelines at it yet — but if you've ever handled image metadata in a Node service, keep reading.

If you work with photos in Node or TypeScript, at some point you've written something like this:

```ts
import { execFile } from 'node:child_process';

const { stdout } = await execFile('exiftool', ['-j', '-n', 'photo.jpg']);
const meta = JSON.parse(stdout)[0];
// meta.Make: "Canon". meta.ExposureTime: "1/200" as a string. Or a number.
// Or undefined. TypeScript knows nothing. You know nothing.
```

ExifTool is the gold standard for reading image metadata — a 30k-line Perl program that knows everything about everything. From JavaScript it has always been a subprocess, though. You pay the Perl interpreter startup on every call, you either spawn per file or manage the `-stay_open` daemon protocol yourself, the output is strings you parse and coerce, and none of it has types.

I got tired of that, so I rewrote the parts I need in TypeScript.

## What it is

[@woss/exiftool](https://www.npmjs.com/package/@woss/exiftool) is on [npm](https://www.npmjs.com/package/@woss/exiftool) and [JSR](https://jsr.io/@woss/exiftool). The CLI is a drop-in for the common cases:

```bash
npm i -g @woss/exiftool
exiftool-ts photo.jpg
```

Or use it as a library — same code, no subprocess:

```ts
import { ExifTool } from '@woss/exiftool';

const tool = new ExifTool();
const info = await tool.read('photo.jpg');

info.tags.Make;         // "Canon" — typed as TagValue
info.tags.ExposureTime; // "1/200" — formatted the way exiftool prints it
```

`read()` returns an inferred `FileInfo`. Every tag is a known `TagValue`, your editor autocompletes tag names, and the compiler catches typos instead of your users. Zero runtime dependencies, ESM-only, Node 18+. It reads and writes JPEG, PNG, WebP and AVIF/HEIF, and reads the TIFF family. Writes go through the same in-memory pipeline and create the classic `photo.jpg_original` backup unless you say otherwise.

## In the browser, no server

The parser core doesn't touch Node APIs, so there's a browser export that ships the same parsers for in-memory buffers. Client-side EXIF reading with no upload:

```ts
import { ExifTool, MODERN_PLUGINS } from '@woss/exiftool/browser';

const tool = new ExifTool({ plugins: MODERN_PLUGINS });
const bytes = new Uint8Array(await file.arrayBuffer());
const info = await tool.readBytes(bytes);
```

There's a live demo on the docs site — pick a photo, watch it parse locally, nothing leaves your machine: [woss.github.io/exiftool/demo](https://woss.github.io/exiftool/demo/). The browser bundle is about 5 MB and loads lazily on first use, so it doesn't weigh down the page.

## Why parity beats a clean-room rewrite

This is the part I care about most, so it gets the most words.

A metadata library is only as good as its output matching what exiftool prints. Reimplementing 30k lines of Perl by hand guarantees divergence: you will get a PrintConv table wrong, you will miss a makernote quirk, and your users will file bugs that say "exiftool says 27.3 mm, your thing says 26.9 m".

So instead of trusting my reimplementation, I made the real exiftool the test oracle. CI runs a parity suite that pipes the same fixtures through both implementations and diffs every shared tag — 66,156 comparisons across the test assets on the last full run. Any undocumented divergence fails the build.

The tag database isn't hand-maintained either. It's generated from the ExifTool Perl source at build time — thousands of tag definitions with their print conversions — so when exiftool learns a new tag, a build step picks it up.

That's the design I'd defend: don't re-type ExifTool's knowledge, reuse it as ground truth and wrap it in types.

## What doesn't work yet

Early development, and I'd rather you hear it from me:

- MakerNotes decoding, RAW containers (CR2/DNG and friends), PDF and video: not started.
- Writes cover an IFD0 tag subset on JPEG/PNG/WebP/AVIF, with `photo.jpg_original` backups — not exiftool's full write surface.
- Known divergences are registered, not hidden: file dates without timezone offsets, `LensID` needs Canon makernote lookup tables, a few rational print conversions (`FlashCompensation` prints as a fraction instead of a decimal), crop-factor dependent `FOV` and `FocalLength35efl`, SubSec composite dates not merged yet.

Every one of those has a documented reason in the code, and the list only shrinks when a fix lands. The deal is simple: if a divergence isn't in the register, the output matches exiftool.

## How it was built

Full disclosure: most of this code was written by AI agents, not by me typing. The setup is opencode, with a main agent plus specialist sub-agents — scout for codebase exploration, reviewer for critique, task agents for parallel work — running mostly on deepseek-v4-flash in the final stretch. I reviewed behavior after every change.

The models are fast and confidently wrong, though. What made this usable was the pipeline around them: the parity suite proves every value against the real binary, the coverage audit demands 100% line and function coverage across 37 modules, the build is forced to stay warning-free, and releases publish with signed provenance. The agents wrote code. The gates decided what survived.

If you're doing AI-assisted development, that's the trade I'd recommend: spend the effort on oracles, not on prompts.

## Links

- GitHub: [github.com/woss/exiftool](https://github.com/woss/exiftool)
- npm: [npmjs.com/package/@woss/exiftool](https://www.npmjs.com/package/@woss/exiftool)
- JSR: [jsr.io/@woss/exiftool](https://jsr.io/@woss/exiftool) (runs from TypeScript source, for Deno)
- Docs: [woss.github.io/exiftool](https://woss.github.io/exiftool/)
- Live demo: [woss.github.io/exiftool/demo](https://woss.github.io/exiftool/demo/)

If you use it and hit a tag that doesn't match, that's a bug report I want — and a pull request that shrinks the divergence register is the fastest way to help.
