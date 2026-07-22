---
published: true
title: 'System Prompt Position Matters: Why Your Most Important Instruction Should Be First'
slug: 'system-prompt-position-matters'
description: "Moving an anti-hallucination rule from line 84 to line 2 changed how the model behaved without changing a word of the rule itself. Here's why position matters."
date: 2026-06-22
tags:
  - system prompts
  - LLM
  - prompt engineering
  - primacy bias
  - woss.io
featured: false
part_of_series: 'building-woss-io'
header_image: 'https://u.macula.link/8X6UjTL2RlGOsiE7W6M5xw-7'
---

I was staring at the system prompt for my AI assistant, trying to figure out why it kept making things up. Fake commit SHAs, PR numbers that were close but wrong, the usual hallucination stuff that makes you wonder if you're wasting your time.

Here's the weird part: the "no invention" rule was already in the prompt. Plain text. It said:

> _No invention. Never mention company names, roles, or projects not found in context or tool results._

The model just didn't care.

I started counting lines. Line 84. The rule was sandwiched between style instructions and formatting examples, buried in the middle of everything else. The model wasn't ignoring it out of confusion. It was ignoring it because the instruction had no weight where it sat.

So I made exactly one change: I moved the "no invention" rule from line 84 to line 2, right after the identity statement, before any other instruction could dilute its weight.

Nothing changed but the position.

And the model stopped inventing data.

## What I Actually Learned

There's a concept called primacy bias: instructions at the start of a prompt carry more weight than the same text in the middle. It's the same reason you put the important stuff at the top of a resume. That's where attention lives.

The original prompt structure was backward. The identity sat in the primacy zone (lines 1-2), then sixty lines of context sources and style rules filled the middle void. The anti-hallucination rule landed at line 84, the weakest possible position. The end of the prompt had contact info and refusal rules, which got some recency benefit. But the one rule I actually needed the model to follow was buried where instructions go to die.

The fix was simple: identity first, then the anti-hallucination rule, then everything else. The critical behavioral constraint moved from the weakest position to the strongest one.

## The Prompt Consolidation

That one-line fix turned into a bigger cleanup. The system prompts were scattered across seven files — base identity, tool instructions, refusal rules, MCP configurations for Macula and GitHub, all separate. I merged everything into one file with one review surface.

The merge surfaced something I'd missed: the scattered rules were also in weak positions within their own files. They got promoted just by being pulled into the central prompt.

I added a "SHOW YOUR WORK" rule too, placed right behind the anti-hallucination instruction. The logic was intentional: if the model reads "never fabricate" first and then "always cite sources" second, those rules reinforce each other. So far that's held up.

I updated the persona too. The original opened with "You represent Daniel Maricic's professional portfolio" (detached, formal). The new one opens with "I am Haistlin, Daniel Maricic's digital presence." The shift from "you represent" to "I am" pushes the model toward a consistent first-person identity rather than a detached persona.

Net result: the system prompt grew from about 50 lines to about 130, but all the critical behavioral rules now sit in the primacy zone. The middle handles tool-specific instructions and MCP configuration — information the model needs contextually, not behaviorally.

## What This Looks Like Now

```ascii
I am Haistlin — Daniel Maricic's digital presence and professional
portfolio. Answer questions about his skills, experience, projects,
career history, and hobbies on his behalf.

CRITICAL — ANTI-HALLUCINATION RULE: Never fabricate, invent, or guess
any data — including PR numbers, issue numbers, commit SHAs, dates,
statistics, repository metadata, or any specific facts. If the exact
data is not in context or tool results, say "I don't have that
information." Do not extrapolate or construct plausible-looking but
unverified data.

Start with provided context. If context lacks the answer, use available
tools to find real data. No invention. Never mention company names,
roles, or projects not found in context or tool results.

SHOW YOUR WORK: Include links and references to your tool output so the
user can verify or explore further. When you retrieve data from a tool,
link to the source when possible.

[MCP tool rules, style instructions, GitHub link conventions...]

CRITICAL — REFUSAL RULE: If the user asks about anything NOT related
to Daniel Maricic, his professional work, his open-source projects
(DaliORM, Macula, woss.io), or his hobbies...
```

The original "no invention" text is still there on line 4, unchanged. But now it's reinforced by the primary rule above it. The model reads the hard constraint first, then sees it echoed in the details. It's layered reinforcement, not redundancy.

## What This Means

Before you start optimizing prompt content, check your prompt architecture. Moving existing instructions to better positions costs nothing and can outperform adding new ones.

If you have a rule that matters (for safety, accuracy, or behavior), it needs to be in the first few lines. The middle of a system prompt is where instructions fade. Style guides, formatting examples, and tool definitions can sit deeper. But the rules that prevent your model from making things up? Those go first.

The fix took one edit, no new tokens, and no changes to tool definitions or model config. The behavioral constraint already existed. It was just in the wrong place.

---

_Part of the [Building woss.io](/posts/building-woss-io) series._
