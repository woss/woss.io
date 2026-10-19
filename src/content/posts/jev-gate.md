---
published: true
title: 'One Word Yes: Moving Relevance Gate Off the Main Model'
slug: 'jev-1.13-relevance-gate'
description: 'The chat on woss.io asks one question before anything else: is this message even about Daniel? That question used to go to the same big model that answers everything. Now a small classifier called Jev handles it, and the difference is the contract, not the speed.'
date: 2026-10-19
tags:
  - LLM
  - classifiers
  - relevance gate
  - Jev
  - woss.io
featured: false
part_of_series: 'building-woss-io'
---

## The question before every question

Every message sent to the chat on this site passes through a bouncer. Before the main model sees a single token, a smaller question gets answered first: _is this message even about Daniel?_

Portfolio assistant, remember? If you ask it who won the game last night, the honest answer costs real money to generate, and "sorry, I only talk about Daniel's work" is the only right response. So there is a relevance check up front. If the answer is no, you get a strike. Three strikes and the chat locks itself. That's not hostility, it's self-preservation: a public chat bot with a main model attached will otherwise subsidize everyone's curiosity about the weather or programming python scripts :).

The gate itself is a decent chunk of the request path. It only skips messages that already look like tool calls (keyword checks, then a tool classifier for short ambiguous ones). Everything else pays the toll: one extra model call, on every message, before any real work starts.

A while back I wrote about [our classifier lessons](/posts/classifier-lessons), including the relevance gate in its first form. This post is the sequel, because I just moved that gate off the main model and onto a dedicated classifier called Jev. The interesting part isn't what you'd expect. It wasn't about speed.

## How the gate used to work

The old setup was embarrassingly simple, which is why it survived so long. The relevance check was a regular chat completion. Same provider, same model as the main assistant, `deepseek-v4-flash`. The prompt said something like "answer only yes or no," and the code did this:

```ts
const answer = (msg?.content || msg?.reasoning_content || '').trim().toLowerCase();
return answer === 'yes';
```

I measured the actual latency from our production logs, pairing the "sending prompt" line with the "got answer" line on the same trace. Nine pairs from the two weeks before the switch: median about a second, p95 around 1.4s, worst 1.7s. That's the tax every message paid before the assistant even started thinking.

But latency was never the real problem. Look at that last line of code again, the contract with the model was _one word, exactly lowercase, no punctuation_, and the enforcement of that contract was a string comparison. If the model replied "Yes." with a period, or "yes, I can help with that," the gate returned `false`. Not an error, so not caught by the fail-open path. Just a normal, confident, wrong no.

Which meant: a real question about Daniel's work, answered politely by a helpful model, got punished with an off-topic strike. Three of those and the chat locks. The failure mode wasn't downtime. It was the gate quietly punishing users for the model's personality.

The fail-open policy only covered thrown errors: timeouts (5 seconds) and provider failures return `true`, on the theory that answering an off-topic question is a smaller sin than blocking a real one. Good policy, wrong scope. Parse mismatches weren't errors, they were just wrong answers wearing normal answers' clothes.

## Enter Jev

The fix arrived as a new endpoint: [Jev System One](https://opencode.ai), a classifier service. You POST a question spec instead of a chat conversation:

```json
{
  "model": "jev-1.13",
  "questions": {
    "is_relevant": {
      "type": "noul",
      "instructions": "Is this message about Daniel's professional portfolio, skills, experience, projects, or career history?",
      "criteria": {
        "true": "About Daniel's portfolio, skills, projects, career, or polite conversation",
        "false": "Politics, sports, entertainment, weather, general knowledge, math, coding help"
      }
    }
  }
}
```

And instead of prose you can mis-parse, you get a number:

```json
{
  "model": "jev-1.13",
  "answers": { "is_relevant": { "type": "noul", "noul": 0.75 } },
  "usage": { "input_tokens": 526, "output_tokens": 23 }
}
```

That `noul` is a probability that the criteria are met. The gate is now a threshold comparison, and the threshold is a config value: currently 0.7 in production.

The code lives in `src/lib/server/relevance-gate.ts`, and the whole thing is intentionally simple. Send the spec and if the response is missing `answers.is_relevant.noul`, or the number isn't finite, throw. The caller catches, logs, and fails open. Malformed answers are errors now, so they land on the fail-open side of the policy where they belong.

## The numbers

From real production traffic since the switch, three examples straight from the logs:

| Question type      | noul | Verdict | Tokens (in/out) |
| ------------------ | ---- | ------- | --------------- |
| On-topic, passed   | 0.75 | through | 526 / 23        |
| Off-topic, blocked | 0.13 | strike  | 633 / 23        |
| Off-topic, blocked | 0.05 | strike  | 703 / 23        |

I also ran three fresh questions through the endpoint directly, timing them: 977ms for an on-topic question (scored 0.93), 678ms for "who won the game last night" (0.01), 454ms for a borderline one (0.47, blocked at 0.7). So roughly the same latency class as before, maybe a touch faster. If this were a speed story, it would be a boring one.

One caveat from that test: the borderline question was "does he know exiftool?", which is absolutely on-topic here. It scored 0.47 under my _simplified_ test instructions. The production rubric names the actual projects explicitly, which is exactly the kind of specificity these scores depend on. A classifier is only as good as its criteria, and vague criteria will bite you somewhere you didn't look. The production logs so far show clean separation (0.75+ for real questions, 0.13 and below for junk), but it's been a day. I'll take the day-old data over the lab, and keep an eye on both.

## What we actually bought

Not speed. Let me be honest about that, the old gate averaged about 1.1 seconds, the new one lands in the same few-hundred-milliseconds-to-a-second range. If you're shopping for a 10x latency win, this isn't it.

What we bought:

**A number instead of a vibe.** The old contract was a string comparison against a model's ability to follow formatting instructions. The new contract is a probability plus a threshold, and when the model changes behavior, we tune one number instead of debugging prose.

**Tiny details.** We started at threshold 0.5, moved to 0.7 when I switched to the paid `jev-1.13` tier (the free tier exists and works; production runs the paid one). Tuning a threshold is a one-line deploy, retuning a prompt-and-parse combo is an afternoon of testing other people's punctuation habits.

**Keep it simple.** The old gate ran on `deepseek-v4-flash`, the same model as everything else. Swap the main model, and the gate's behavior changed too, whether you remembered to test it or not. Now `MAIN_MODEL` and the gate are independent. We can change the assistant's brain without touching its bouncer.

**23 output tokens.** Every single time. The old path ran on a general-purpose model that might reason, might preamble, might get creative with "yes." The classifier emits the structured answer and stops. That's not just cheaper; it's _predictable_, which for a gate is the whole point.
