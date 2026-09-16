---
published: true
title: 'ExifTool, in TypeScript: no Perl sidecars, no untyped JSON'
slug: 'exiftool-in-typescript'
featured: true
description: 'I ported ExifTool to TypeScript: typed reads and writes, zero runtime dependencies, a drop-in CLI, and a parity suite that diffs against the real exiftool binary on every build. Early development: what works, what does not, and why.'
date: 2026-09-06
tags:
  - ExifTool
  - metadata
  - CLI tools
  - open source
  - AI-assisted development
audience: general
---

@woss/exiftool is in early development. Expect breaking changes and rough edges on the way to 1.0. Don't point production pipelines at it yet. But if you've ever handled image metadata in a Node service, keep reading.

If you work with photos in Node or TypeScript, at some point you've written something like this:

```ts
import { execFile } from 'node:child_process';

const { stdout } = await execFile('exiftool', ['-j', '-n', 'photo.jpg']);
const meta = JSON.parse(stdout)[0];
// meta.Make: "Canon". meta.ExposureTime: "1/200" as a string. Or a number.
// Or undefined. TypeScript knows nothing. You know nothing.
```

ExifTool is the reference for reading image metadata: a 30k-line Perl program that knows everything about everything. From JavaScript it has always been a subprocess, though. You pay the Perl interpreter startup on every call, you either spawn per file or manage the `-stay_open` daemon protocol yourself (a hand-rolled text protocol that keeps one Perl process alive between calls), and the output is strings you parse and coerce (`'1/200'` vs `0.005`, dates whose format depends on the file, the same tag sometimes a number and sometimes a string). None of it has types.

I got tired of that, so I rewrote the parts I need in TypeScript.

## What it is

[@woss/exiftool](https://www.npmjs.com/package/@woss/exiftool) is on [npm](https://www.npmjs.com/package/@woss/exiftool) and [JSR](https://jsr.io/@woss/exiftool). The CLI is a drop-in for the common cases:

```bash
npm i -g @woss/exiftool
exiftool-ts photo.jpg
```

Or use it as a library, same code, no subprocess:

```ts
import { ExifTool } from '@woss/exiftool';

const tool = new ExifTool();
const info = await tool.read('photo.jpg');

info.tags.Make;         // "Canon", typed as TagValue
info.tags.ExposureTime; // "1/200", formatted the way exiftool prints it
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

There's a live demo on the docs site: pick a photo, watch it parse locally, nothing leaves your machine. [woss.github.io/exiftool/demo](https://woss.github.io/exiftool/demo/). The browser bundle is about 5 MB and loads lazily on first use, so it doesn't weigh down the page.

## Performance, measured not vibes

Quick benchmark on my machine (M2 Max, ExifTool 13.55 as reference, real-world JPEG libraries, 543 files, ~8.7 GB total):

| Scenario | exiftool | exiftool-ts |
|---|---|---|
| Single file, cold process start | ~150 ms | ~150 ms (node CLI), ~125 ms (bun CLI) |
| 218 mixed files (~3.1 GB) in one process | 3.9 s (~18 ms/file) | 2.1 s (~10 ms/file) |
| 325 large JPEGs, 5.6 GB, avg 17.7 MB/file | 4.5 s (~14 ms/file) | 2.8 s (~8.5 ms/file) |
| Peak memory, same batches | ~30 MB | ~0.5–0.8 GB |

Parse time scales with file size, roughly 0.5 ms per MB on this hardware, since the parser walks the whole buffer: the small half (~9 MB avg) parses in ~6 ms, the big half (~26 MB avg) in ~12 ms.

Read it honestly: a cold single-file CLI call is a tie, because interpreter startup dominates both, Perl and node alike. The win is the library path: no subprocess means batch reads run ~2x faster in-process. Memory is the honest tradeoff. V8's heap runs a much larger high-water mark than Perl's working set. It's bounded, not a leak. Live heap stays flat at ~25 MB no matter how many files run, and the peak is node's allocator caching freed 17 MB buffers, not the parser: the same batch of raw `readFileSync` calls with no metadata parsing at all peaks *higher* (710 MB) than the full library run. If you're processing a huge library in one process, exiftool-ts trades RAM for speed.

## Why parity beats a clean-room rewrite

This is the part I care about most, so it gets the most words.

A metadata library is only as good as its output matching what exiftool prints. Finding tags is the easy part. The value is decades of accumulated knowledge baked in: PrintConv tables that format raw values the way photographers expect (`0.005` → `'1/200'`), makernote quirks (every camera vendor stores its own metadata in a different undocumented binary format), composite tags derived from several others. Reimplement that by hand and you'll get a PrintConv table wrong, or miss a makernote quirk, and the bug reports will say "exiftool says 27.3 mm, your thing says 26.9 mm".

So instead of trusting my reimplementation, I made the real exiftool the test oracle. CI runs a parity suite: the same fixture files go through both implementations, and every tag value both can report is compared, formatted exactly the way each would print it. Last full run that was 66,156 comparisons across the test assets. Any undocumented divergence fails the build.

The tag database isn't hand-maintained either. A build step parses exiftool's Perl source and extracts its tag tables (tag names, numeric ids, print conversions) and emits them as TypeScript. When exiftool learns a new tag, the library inherits it on the next regeneration.

That's the design I'd defend: don't re-type ExifTool's knowledge, reuse it as ground truth and wrap it in types. How the parity suite selects fixtures, compares values, and handles the known-divergence register is documented in the [parity guide](https://woss.github.io/exiftool/parity).

## What doesn't work yet

Early development, and I'd rather you hear it from me:

- MakerNotes decoding, RAW containers (CR2/DNG and friends), PDF and video: not started.
- Writes cover an IFD0 tag subset on JPEG/PNG/WebP/AVIF, with `photo.jpg_original` backups, which is not exiftool's full write surface.
- Known divergences are registered, not hidden: file dates without timezone offsets, `LensID` needs Canon makernote lookup tables, a few rational print conversions (`FlashCompensation` prints as a fraction instead of a decimal), crop-factor dependent `FOV` and `FocalLength35efl`, SubSec composite dates not merged yet.

Every one of those has a documented reason in the code, and the list only shrinks when a fix lands. The deal is simple: if a divergence isn't in the register, the output matches exiftool.

## How it was built

Full disclosure: most of this code was written by AI agents, not by me typing. The harness is [omp](https://github.com/can1357/oh-my-pi) (Oh My Pi): a main agent coordinating specialist sub-agents (scouts for codebase exploration, reviewers for critique, task agents for parallel work), with different agents on different models, and several model switches over the life of the project. The final stretch ran mostly on deepseek-v4-flash. I reviewed behavior after every change.

The models are fast and confidently wrong, though. They invent tag names, misparse binary structures, and claim fixes work without having run anything. What made this usable was the pipeline around them. The parity suite proves every value against the real binary. A coverage audit demands 100% line and function coverage across 37 modules. Builds stay warning-free and releases publish with signed provenance. The agents wrote the code, but the gates decided what survived, and the gates never take an agent's word for anything.

If you're doing AI-assisted development, that's the trade I'd recommend: spend the effort on oracles, not on prompts.

## Links

- GitHub: [github.com/woss/exiftool](https://github.com/woss/exiftool)
- npm: [npmjs.com/package/@woss/exiftool](https://www.npmjs.com/package/@woss/exiftool)
- JSR: [jsr.io/@woss/exiftool](https://jsr.io/@woss/exiftool) (runs from TypeScript source, for Deno)
- Docs: [woss.github.io/exiftool](https://woss.github.io/exiftool/)
- Live demo: [woss.github.io/exiftool/demo](https://woss.github.io/exiftool/demo/)

And this is where you come in. Testing is the one thing I can't scale alone: I have a fixture set, you have a camera I've never seen. Throw your own library at it: pick a photo in the [browser demo](https://woss.github.io/exiftool/demo/), or point the CLI at a folder and diff its output against the real exiftool. Every mismatch, crash, or file that parses strangely is a bug report I want. The weird files are exactly how makernote support gets built. And if you'd rather write code than reports: a pull request that shrinks the divergence register, ports a PrintConv table, or takes on MakerNotes is the fastest way to help.

One thing I still haven't figured out: whether the memory high-water mark can come down at all. Raw `readFileSync` over the same files peaks higher than the full parse, which points at node's allocator rather than the parser, and I haven't found a lever that trades a little of the speed for a lower peak. If you know that lever, that's the issue I want most.
