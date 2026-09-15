---
published: true
title: 'ExifTool, for the browser: metadata parsing without the server'
slug: 'exiftool-for-the-browser'
featured: true
description: 'ExifTool is the gold standard for image metadata, but it lives on servers. exiftool-ts 0.3.0 runs the same idea in your browser: lazy-loaded format plugins, merge writes, and a parity suite against the Perl original.'
date: 2026-09-15
tags:
  - ExifTool
  - TypeScript
  - browser
  - open source
audience: general
---

A real desktop app stopped shelling out to Perl exiftool this month. It stamps license information on photos now, in the browser, using this library. That's the short version of this post. The longer version is what shipped in 0.3.0, two bugs I hit on the way, and the list of things that still don't work.

Usual caveat, same as last time: early software, breaking changes likely, don't point production at it yet.

## TL;DR

- exiftool-ts 0.3.0 is on [npm](https://www.npmjs.com/package/@woss/exiftool). 564 tests. Reads JPEG, PNG, WebP, AVIF/HEIF, and TIFF-family RAW files: CR2, NEF, ARW, ORF, RW2, PEF, ERF, DCR, SRW, DNG.
- Formats are lazy-loaded plugins now. Restrict an instance to the parsers you want and the bundler skips the rest. The RAW reader is a 5.3 MB chunk that a JPEG gallery never downloads.
- `write` changes only the tags you pass. MakerNotes, GPS, thumbnails: byte-for-byte untouched, checked against exiftool's own diff.
- Every build diffs output against the real exiftool. When the two disagree, I treat that as my bug until proven otherwise.

## Credit where it's due

ExifTool is the best image metadata tool that exists and I have no interest in pretending otherwise. Around thirty thousand lines of Perl that Phil Harvey has maintained since 2003, and it knows things about camera files that no other software knows. When I say my port matches exiftool, that's only testable because exiftool exists to compare against.

So the pitch is not "Perl is bad". Perl is great. Perl just cannot run in a browser tab, and a browser tab is where a growing chunk of photo handling actually happens: people pick a file in a web app and expect the app to know what it is.

I wrote about the first cut of this in September: [ExifTool, in TypeScript](/posts/exiftool-in-typescript/). That post was architecture and intent. This one is what actually shipped since, which came in slower than I hoped and in stranger shapes than I planned.

## What 0.3.0 does

The package is [@woss/exiftool](https://www.npmjs.com/package/@woss/exiftool), zero runtime dependencies, ESM, Node 18+. Reads and writes JPEG, PNG, WebP and AVIF/HEIF, reads the whole TIFF RAW family listed above, and writes JPEG with what I'll argue below is the important part: merge semantics. Same code runs in the browser through the `@woss/exiftool/browser` entry, on buffers instead of file paths.

The test count went from "some tests" in September to 564 across 40 files, and the part I actually trust is not the count. It's that CI still diffs every shared tag value against the real exiftool binary, formatted the way each implementation would print it. Last full run that was 66,156 comparisons. If a value diverges and it isn't in the documented known-divergence register, the build fails.

## Formats are plugins now

Here's something embarrassing I only measured recently: until a few weeks ago, the browser build shipped the entire DNG and RAW tag database so it could read `Make` and `Model` from a JPEG. The TIFF-RAW parser chunk alone is 5.3 MB. Nobody needs a DNG tag table to read a phone photo. Nobody complained either, because it loaded lazily and nobody profiled it. I only found it because I was sizing the bundle for this post.

The fix changed the library's shape. Formats are plugins now:

```ts
import { ExifTool } from '@woss/exiftool';
import { MODERN_PLUGINS } from '@woss/exiftool/plugins';

const tool = new ExifTool({ plugins: MODERN_PLUGINS }); // JPEG, PNG, WebP, AVIF, TIFF RAW (read-only)
```

`new ExifTool()` with no options still loads every built-in, lazily, exactly like before. But restrict the instance to a set and, with `sideEffects: false` plus the plugins on their own subpath, tree-shaking drops the parsers you didn't name. You can go narrower than `MODERN_PLUGINS`: `jpegParser`, `pngParser`, `webpParser`, `avifParser` and `tiffRawParser` all come from the same subpath. Custom plugins are plain objects with `{ format, extensions, canParse, parse }`, and an optional `writeBytes` if the format supports writing. Leave `writeBytes` off and the plugin is read-only.

Measured on the current dist output: the browser entry is 8 kB, the modern-formats chunk about 460 kB raw, roughly 105 kB gzipped. The RAW reader sits in its own 5.3 MB chunk, about 590 kB gzipped, and only loads when a TIFF-family file actually shows up. I went back and forth on whether 590 kB for a lazy RAW chunk is acceptable. My conclusion: yes, because the alternative is either dropping RAW support or making every JPEG reader pay for it, and both are worse. The chunk is lazy; a gallery of iPhone photos never pays a byte of it.

If you want to see it work without installing anything: the [live demo](https://woss.github.io/exiftool/demo/) parses photos entirely in your tab. Nothing uploads.

## The merge-write guarantee

The Kelp Market desktop app used to stamp license info on photos by shelling out to Perl exiftool. That works, until you want it in an Electron app without bundling Perl, or on a file the user picked in a browser. They switched to this library, and the switch hinged on one guarantee: writing a tag must not disturb any other byte of metadata.

This matters because cameras cram undocumented vendor blocks into files. Rebuild the metadata section naively and you drop or mangle a maker note, and the photo still opens fine in Preview but the camera's own software chokes on it. That class of bug is nasty because it ships silently.

So `write` and `writeBytes` do merge writes. Change only what you asked to change:

```ts
const { written } = await tool.writeBytes(imageBuffer, {
  Copyright: '© 2026 Woss',
  Rights: '© 2026 Woss',
  WebStatement: 'https://example.com/license',
  Orientation: 1,
});
```

Run exiftool's own diff on the result and you see exactly those four tags. Nothing else moved.

Getting there took longer than I expected, and two bugs are worth confessing. First: while testing the writer I found our own XMP parser had been silently wrong for months. It captured everything up to the first closing `</rdf:Description>` tag. Fine for flat XMP, wrong the moment a file nests descriptions, which real files do. Real exiftool read those files correctly the whole time; our reader truncated them without an error. The parity suite only caught it once the writer started producing files that exercised the path. Second: the first version of the TIFF builder could infinite-loop on a GPS coordinate string it couldn't parse, and synthesized a nonsense hemisphere reference value while it was at it. Both fixed, both now have regression tests, and both were found by writing files rather than reading them, which is why I keep telling people the writer side needs more testing than it gets.

One honest limitation on this story: merge writes are proven on JPEG. PNG, WebP and AVIF write support exists but doesn't have the same byte-preservation guarantee worked out yet. If your use case is "stamp a JPEG in the browser", that's the solid path today.

## Why the CLI is called `exiftool-ts`

The npm package is `@woss/exiftool`; the binary it installs is `exiftool-ts`, deliberately not `exiftool`. A global install named `exiftool` would shadow Phil Harvey's binary on your PATH, and plenty of tools on your machine depend on the real one. Install this and they sit side by side. Nobody has to find out what broke.

## What doesn't work yet

I'd rather list this than get quiet bug reports about it:

- XMP writing covers the two rights properties (`Rights`, `WebStatement`), not the full schema. IPTC-IIM writes: not started.
- Merge-write guarantees on PNG/WebP/AVIF, as above.
- CR3 (Canon's newer RAW) and RAF (Fuji): no reads. Both need container work nobody has written yet.
- MakerNotes decode for Canon, Nikon, Sony, Olympus, Pentax and Panasonic. That list grew out of whatever cameras people sent me files from. Your camera not being on it is a data problem, not a design one: I can't reverse a makernote format I've never seen.

Every item has a documented reason in the code. The list shrinks when fixes land, and it has been shrinking.

## The numbers, again

The table below is the benchmark from the September post, same machine, same fixture set. I have not re-run it for 0.3.0. The parse path changed since then (maker-notes decoding, the XMP work), so treat these numbers as roughly right rather than current; re-benchmarking against the same 543-file set is on my list.

| Scenario | exiftool | exiftool-ts |
|---|---|---|
| Single file, cold process start | ~150 ms | ~150 ms (node CLI), ~125 ms (bun CLI) |
| 218 mixed files (~3.1 GB) in one process | 3.9 s (~18 ms/file) | 2.1 s (~10 ms/file) |
| 325 large JPEGs, 5.6 GB, avg 17.7 MB/file | 4.5 s (~14 ms/file) | 2.8 s (~8.5 ms/file) |
| Peak memory, same batches | ~30 MB | ~0.5–0.8 GB |

Same honest reading as before. Batch reads in-process run about twice as fast as shelling out. Memory is the cost: V8 holds a much larger high-water mark than Perl does. In the browser, though, the comparison dissolves, because there is no Perl subprocess to compare against. The alternative to client-side parsing is uploading the photo to a server that has exiftool, and for a lot of uses (privacy, latency, cost) that alternative is the one that lost.

## Try it, break it

I have a fixture set. You have a camera I've never seen. That asymmetry is the whole bottleneck: makernote formats are undocumented, and the only way this library learns yours is if a file from it lands in the issue tracker.

So: run your photo library through the [browser demo](https://woss.github.io/exiftool/demo/) or the CLI, diff against real exiftool if you have it, and file what breaks at [github.com/woss/exiftool/issues](https://github.com/woss/exiftool/issues). A crash with the offending file attached is the single most useful thing you can send. Code help is welcome too, and if you want to know where the bodies are buried, the divergence register is the map.

One question I haven't answered for myself: is per-format the right cut for plugins, or should the axis be capability, read versus write, so you can ask for "everything that can write" without naming formats? I went with format because it maps to bundle chunks. If you build with this and the format axis fights you, that's an issue I want.

## Links

- Original ExifTool, by Phil Harvey: [exiftool.org](https://exiftool.org/). If this project saves you time, his saved you more first.
- GitHub: [github.com/woss/exiftool](https://github.com/woss/exiftool)
- npm: [npmjs.com/package/@woss/exiftool](https://www.npmjs.com/package/@woss/exiftool)
- Live demo: [woss.github.io/exiftool/demo](https://woss.github.io/exiftool/demo/)
- Docs: [woss.github.io/exiftool](https://woss.github.io/exiftool/)
- Prior reading: [ExifTool, in TypeScript](/posts/exiftool-in-typescript/), the September intro, with the parity-suite and build-process details this post skips.
