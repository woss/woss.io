---
published: false
title: 'When Your AI Makes Up a Blog Post: A RAG Hallucination Story'
slug: 'when-ai-fabricates-post'
description: 'A user asked for the latest blog post. The AI happily fabricated one — with a title, excerpt, and publication date. None of it was real. Here is how that happened, how we traced it, and the three-layer fix whose layers themselves needed patching before it held.'
date: 2026-06-22
tags:
  - LLM
  - RAG
  - hallucination
  - vector search
  - prompt engineering
  - architecture
  - woss.io
featured: false
part_of_series: 'building-woss-io'
---

A visitor asked "show me the last post you wrote." The AI answered with a blog post titled _The Cosmic Dance of IPFS and DNS_, including a publication date and a short excerpt. The post doesn't exist. It never existed. The AI made it up.

That's the problem with RAG hallucinations — they look exactly like real answers. The title was plausible, the topic was in my general area of interest, the tone matched. Anyone reading that response would have assumed the site actually had an article about IPFS and DNS. It took a manual log inspection to catch it.

## What Happened

The exchange looked normal from the outside. User types a question, AI streams back an answer, done. The response had a title, a date, a preview — everything you'd expect from a legitimate answer. No warning flags, no hesitation markers, no "I'm not sure" qualification.

I only caught it because I was reviewing logs for a different issue. The trace for that chat caught my eye: the response mentioned a blog post I'd never written. I checked the database. Checked the content directory. Nothing. The fabricated post was an artifact — a hallucination seeded by the LLM's training data, where the model had seen enough blog post patterns that it could generate a convincing fake.

The chain of events that led to this was instructive. Here is the exact sequence from the logs:

First, the centroid-based query classifier ran. It returned `hybrid` — meaning it couldn't confidently categorize the query as a tool request, a RAG question, or a meta question about the site. The scores told the story: tool=0.68, meta=0.63, rag=0.60. All three were close. None was decisive.

Second, the tool classifier ran. It correctly returned `none` — the prompt fix I'd applied from a previous bug was working. The query didn't need GitHub or Macula tools.

Third, RAG search ran. The embedder converted the query into a 1024-dimensional vector and searched the 5 nearest neighbors in the USearch index. Every single result had a cosine distance >= 0.3 — the threshold I'd set to filter out low-relevance matches. They were all rejected.

Fourth, the LLM received the system prompt with zero context chunks. No relevant content to draw from.

Fifth, the system prompt had a guard: "if tools return no results, say you don't know." That covers the tool case. It didn't cover the empty RAG case.

Sixth, the LLM had no information to work with, no instruction for what to do when RAG returns empty, and a user expecting an answer. So it fabricated one from its training data.

A quick technical detour on the distance metric. USearch uses cosine distance with `MetricKind.Cos` on normalized vectors. The score range is 0 (identical direction) to 2 (opposite direction). I set the threshold at 0.3, which means anything with similarity below about 0.7 gets tossed. The query "show me the last post you wrote" is asking about metadata — which post is most recent. The chunks in the vector index contain body text. The embedding of a metadata query is naturally far from any content embedding, because they're answering fundamentally different questions.

## Why Vector Search Fails for Metadata Queries

Vector search is great at finding semantically similar content. You embed a paragraph about SvelteKit data loading, and it finds other paragraphs about SvelteKit data loading. That's the use case it was designed for.

It's terrible at questions about structure or metadata. "Which post is the most recent?" and "what does this building-woss-io post say about architecture?" look nothing alike to the embedding model. The BGE-large-en-v1.5 model captures topic similarity in 1024 dimensions. It doesn't model recency, existence, or structural relationships.

This is a known limitation of dense retrieval. It's not a bug in BGE or USearch — it's a property of the approach. Dense retrieval maps text to a semantic vector space where proximity means topical relatedness. Metadata questions map to a different semantic space than their answers. The question "do I have a post about X?" is a boolean existence check. The answer lives in a database index or a file listing, not in the vector space of document embeddings.

If I had thought about this earlier, I'd have saved myself the debugging. But I was heads-down building the RAG pipeline and the happy path was working. The unhappy path hid until someone actually hit it.

## The Second Wave: Follow-Up Hallucinations

The initial fix looked good on paper. First message in a fresh chat — "show me last post" — returned the correct post title and date. The fallback worked. I considered the issue closed.

Then I tested the follow-up.

**Message 1:** "show me last post" → Correct. "Building woss.io: A Journey Into AI-Powered Personal Portfolios, June 21 2026." The post exists with that exact title and date.

**Message 2:** "yes, show me the summary of the post" → The AI responded with a narrative about finding the file in /posts and produced a summary that referenced tools and file reading. There was only one problem — no tools were loaded. The system prompt said "data must come from a tool call" (line 27 of the prompt) and "call tools if not in context" (line 19). The LLM followed instructions. It couldn't call tools, but it could narrate using them. So it did exactly that: a fictional tool narrative with a plausible-sounding summary.

**Message 3:** "what's the link to the post?" → The AI fabricated a slug: "building-wossio-a-journey-into-ai-powered-personal-portfolios" (lowercase, spaces replaced with hyphens). The actual slug is "building-woss-io." The fallback chunk had injected title + date but not the URL. The LLM did the only thing it could — construct a URL from the title text.

Same root cause, different symptom. Message 1 asked about existence — "do you have a last post?" The fallback answered that correctly. Messages 2 and 3 asked about substance — "what's in it?" and "where is it?" — and the fallback had nothing to offer.

The patterns from the logs told three different stories of the same underlying gap:

For Message 2, the classifier returned none for tools, the RAG returned 0 chunks, the fallback injected 16 post titles into the context. The LLM had titles and dates but no body content. Its system prompt said "if the question can be fully answered from provided context alone, answer without calling tools. If it can't, call the appropriate tools." The context only had titles. The answer needed content. The LLM tried to call tools but none were loaded — so it narrated the tool call instead.

For Message 3, the same pipeline ran, but now the fallback chunk's text field only had "Title (date)" — no URL path. The system prompt's "SHOW YOUR WORK" rule said every data point must come from a tool call. The LLM had no tool calls to point to, no URL in context, and a user wanting a link. It constructed the best guess it could from the title.

## The Fix

Three layers. All three were necessary.

### Layer 1: Empty-RAG Anti-Hallucination Guard

The first layer is a prompt guard in `buildRagPrompt` inside `openai-provider.ts`. When RAG returns zero chunks, the function appends a specific instruction to the system prompt:

```typescript
if (chunks.length === 0) {
  systemPrompt += `\n\nNOTE: No relevant content was found from the portfolio database for this query. If you cannot answer from available context or tools, state that you don't have this information rather than fabricating any specific titles, names, dates, or details.`;
}
```

This covers the case where RAG comes back empty. The LLM gets explicit instruction to say "I don't know" instead of inventing. One if statement, but the gap existed because the existing prompt guard only covered the tool-failure case, not the RAG-failure case.

### Layer 2: Post-Metadata SQL Fallback

The guard alone would make the LLM say "I don't know" for questions like "show me the last post." Honest but not helpful. The second layer answers the question.

In the orchestrator, after RAG retrieves context, I added a fallback. When RAG returns zero chunks AND the query contains words like "post", "blog", "writing", or "article", the system queries the SQL database directly:

```typescript
if (ragChunks.length === 0 && /\b(post|blog|writing|article)\b/i.test(text)) {
  const allPosts = getPosts();
  const published = allPosts
    .filter((p) => p.status === 'published')
    .sort((a, b) => {
      /* sort by date descending */
    });
  if (published.length > 0) {
    const postLines = published
      .map((p) => `- ${p.title} (${p.date ? new Date(p.date).toISOString().split('T')[0] : 'no date'})`)
      .join('\n');
    ragChunks = [
      {
        title: 'Published Blog Posts',
        text: `Daniel's published blog posts (newest first):\n${postLines}\n\nVisit /posts to see all posts.`,
        score: 0,
        slug: '',
        type: 'post',
      },
    ];
  }
}
```

But this had a problem. It only included title and date, not the URL path. That's where Message 3's slug hallucination came from. So I had to go back and add URL paths to the injected text:

```typescript
const postLines = published
  .map((p) => {
    const url = p.slug === 'about' ? '/about' : `/posts/${p.slug}`;
    const date = p.date ? new Date(p.date).toISOString().split('T')[0] : 'no date';
    return `- "${p.title}" (${date}) — ${url}`;
  })
  .join('\n');
```

Now the LLM sees "/posts/building-woss-io" directly in context. No need to guess.

### Layer 3: Fallback-Aware Anti-Hallucination Guard

The empty-RAG guard (Layer 1) only fires when chunk count is zero. But the fallback (Layer 2) sets chunk count to 16. Those 16 chunks are all type "post" — they're metadata, not full content. The guard needed to detect this case too.

The `RagChunk` interface got a new optional field:

```typescript
interface RagChunk {
  title: string;
  text: string;
  score: number;
  type?: string; // 'post' for fallback metadata
}
```

And the guard condition expanded:

```typescript
if (chunks.length === 0 || chunks.every((c) => c.type === 'post')) {
  const isFallback = chunks.length > 0 && chunks.every((c) => c.type === 'post');
  if (chunks.length === 0) {
    systemPrompt += `\n\nNOTE: No relevant content was found...`;
  } else if (isFallback) {
    systemPrompt += `\n\nNOTE: You have access to a list of post titles and their URLs but not the full content of any post. Do not fabricate specific technical details, code examples, or body content from posts you have not read. For URLs, use only those explicitly listed above. Do not construct file paths or slugs from title text.`;
  }
}
```

This kills Message 2's fabrication. The LLM sees "you only have titles, don't fabricate content" and responds honestly: "I have the title and publication date, but not the full body — you can read it at the link below."

### Layer 4 (Bonus): No-Tool Narrative Guard

Message 2 had a more insidious problem. Even with the content guard, the LLM was narrating tool interactions that didn't exist — "let me find the file in /posts" — because the base system prompt told it to "call tools" and "show your work from tool calls." When no tools were loaded, the LLM compensated with fiction.

The fix was a system note in the RAG-only branch:

```typescript
if (messages.length > 0 && messages[0].role === 'system') {
  messages[0] = {
    ...messages[0],
    content:
      messages[0].content +
      `\n\nNOTE: No tools are currently loaded. Do not narrate using, calling, or searching with any tools — they are not available. Answer only from the context provided above.`,
  };
}
```

Explicit. Direct. No room for ambiguity. The LLM can't narrate phantom tool calls when the system prompt explicitly says no tools are loaded.

## What We Learned

**Vector search is not universal.** This is the big one. Dense retrieval answers "what content is topically similar to this query?" It doesn't answer "does this content exist?" or "which is the most recent?" or "what are the titles?" If your retrieval strategy assumes vector search handles every question type, you'll miss the metadata category entirely. The fix isn't to abandon vector search — it's to recognize its limits and route metadata questions to a retrieval strategy that matches them: direct SQL queries, keyword matching, or hybrid search.

**LLMs fabricate confidently when they have nothing.** This isn't a shock to anyone who's worked with LLMs, but seeing it happen in your own system is different from reading about it. The model had zero context chunks. It had no tools available. Its system prompt told it what to do when tools fail but was silent on empty RAG. Faced with a user expecting an answer, it generated a plausible falsehood. The fix was explicit instruction for the gap the original prompt didn't cover.

**Defense in depth matters retrospectively.** The previous fix in the tool classifier — the prompt fix that correctly returned `none` for non-tool queries — worked as intended. But it exposed a deeper problem. Before that fix, tool queries were loading tools even when they shouldn't. After the fix, no tools loaded for this query type. The problem was that now, with no tools AND no RAG content, the LLM had nothing to work with. Each fix uncovered the next weakness. The system got more robust with each layer, but it took hitting the hallucination to find the next gap.

**Prompt instructions cut both ways.** The system prompt told the LLM to "call tools if not in context" and "show your work from tool calls." These instructions make perfect sense when tools are available. When tools aren't loaded, they become hallucination drivers — the LLM follows the instruction literally by fabricating tool calls. The fix was conditional instruction: tell the LLM tools aren't available when they aren't, and suppress the tool-calling instructions at the same time. This is an easy trap to miss because you write the prompt for the happy path and don't realize it's actively harmful on the unhappy path.

**Edge cases hide until they're triggered.** The happy path — good RAG match, tools available — has been working since day one. The near-happy path — no RAG match but tools available — was caught by the tool prompt fix. The far edge — no RAG match, no tools, vague metadata query — waited weeks before someone triggered it. Testing every edge case up front is ideal, but in practice, you fix the ones you find and build monitoring to catch the ones you haven't.

## The Practical Result

Now you can ask "show me the last post you wrote" and get a real answer with actual titles and dates. The chain of three follow-up questions — existence, summary, and link — now returns correct answers at every step. No fabrication, no guesswork. The same fallback handles "what have you written about vector search?" and "list your latest articles." The metadata keyword check is simple but broad enough to catch most metadata queries before they hit the empty-RAG path.

This is one of those fixes that looks obvious in retrospect — of course you should handle the empty RAG case, of course you should have a metadata lookup for metadata questions. But it wasn't obvious before someone triggered it. The system told us where the gap was.

The rest of the posts in this series cover similar pipeline fixes: the [tool classifier prompt fix](/blog/llm-task-classifier) that prevented unnecessary tool loading, and the [position-dependence problem](/blog/system-prompt-position-matters) that showed how prompt ordering changes LLM behavior. Each one follows the same pattern — something worked on the happy path, broke on an edge case, and the fix revealed a deeper insight about how these systems actually behave.
