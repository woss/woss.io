---
published: true
title: 'woss.io MCP: Why Your Personal Site Needs a Data API, Not a System Prompt'
slug: 'woss-io-mcp'
featured: false
description: "Your personal site AI shouldn't cheat. woss.io MCP server gives agents real career data and real writing — no system prompt tricks, no fabricated experience."
date: 2026-07-30
tags:
  - MCP
  - AI
  - portfolio
  - personal site
part_of_series: 'building-woss-io'
header_image: 'https://u.macula.link/Z1TIROJeSMmFYnmvlCOPLg-7'
---

Every personal site with an AI chatbot has the same problem.

You land on someone's portfolio, type "what have you worked on?", and get back a perfectly crafted answer about their career. Right amount of detail, specific projects, humble confidence. But you can't verify any of it. The LLM read the system prompt, saw a list of skills, and started painting. It's not lying, exactly. It's just doing what LLMs do: generating what sounds true based on text it was given.

woss.io takes a different approach. Instead of pumping my career into a system prompt and hoping the LLM doesn't embellish, the site exposes my actual data through MCP.

## What the MCP Actually Does

The server is simple, four tools and two dozen resources. Each tool has real parameters:

```ascii
get_posts(from?, to?, sort?, order?, last?)
  → filter by date range, sort by date/title, grab last N

get_post(slug)
  → one post by slug

get_experience(from?, to?, sort?, order?, keywords?)
  → filter by date, sort by startDate/company/role, keyword search across skills & company & role

search_content(query, type?)
  → semantic search over everything, optionally scope to posts or experience
```

Resources at `woss://experience` and `woss://posts/{slug}` for direct reads. A prompt `analyze_portfolio(focus?)` generates a structured portfolio analysis.

Alongside the MCP, there's also a `woss.io/llms.txt` endpoint, a plain text career timeline following the emerging [llms.txt standard](https://llmstxt.org/). It serves the same experience data in raw text format, no tool calls needed. Between the MCP and `llms.txt`, agents have two ways to discover everything on the site.

No custom prompt templates per tool. No instructions telling the agent to "sound authentic" or "be a helpful assistant for this portfolio." Just structured data any MCP-compatible agent can query.

The difference shows in how answers get built. Ask "what did Daniel work on in 20125" and the agent calls `get_experience`, reads the entries from that period, and tells you what's there. Not what sounds right. What's actually in the database.

I wrote about the build in more detail on [the building woss.io post](/posts/building-woss-io). Short version: real data beats good prompts.

## Why This Matters for Personal Sites

Most AI-powered portfolios are system-prompt hijacking factories in disguise.

The standard pattern: stuff a JSON blob of your career into the system prompt, tell the LLM to "be accurate and helpful," and pray it doesn't invent conference talks you never gave. Some sites go further — dynamic prompts that interpolate your resume, RAG pipelines over CV PDFs, few-shot examples of how to describe you. All of it tries to solve the same problem: how do you make an LLM tell the truth about someone's career?

MCP solves it differently. The agent doesn't need to remember or guess. It calls tools, reads data, and answers from what it finds. No prompt gymnastics required. No "you are an AI assistant representing Daniel Maricić — be warm and professional" wrapper that coaxes the model into playing a character. Just a data API the agent queries naturally.

For someone reading about a potential hire, this matters. Every statement traces back to a source. Tools return real posts and real career entries. Nothing is invented because nothing needs to be. The data was always there — the MCP just makes it readably by AI agents.

## woss.io Doesn't Cheat

I've seen AI portfolio demos where the model goes off script. A "Senior Developer" becomes "Lead Architect with 15 years experience in everything." The AI was tuned to impress, not to be accurate.

woss.io can't do that. The MCP returns what's in the database. If `get_experience` returns "DevOps Engineer, 3 years at Ipsos Simstore," that's what the agent reads. No amount of system prompting can change it to "Distinguished Engineer, 5 years" because the tool call returns what it returns.

This is the part I'm most proud of. The entire career timeline — 14 entries spanning 16 years — is exposed as structured data. Every skill, role, and description is real. The AI doesn't need to invent because it has full access.

To be clear: woss.io's own chat agent does use a system prompt. It has to — it's routing between 11 complex tools, managing streaming responses, formatting output, handling context windows. That kind of orchestration needs instructions. The line isn't "system prompts are bad." It's "don't use system prompts to manufacture a persona you don't have." Describe your tools, describe your behavior, describe your constraints. Don't describe a version of yourself that only exists in text.

## What This Opens Up

The personal site MCP pattern has implications beyond one portfolio.

**AI recruiting reads**: A recruiter's agent queries multiple personal site MCPs in parallel. "Find someone with Kafka, Kubernetes, and platform engineering experience." It reads each candidate's experience resource, compares skills, returns the best match — all from verifiable data, not LinkedIn keyword padding.

**Dynamic CV generation**: Drop in a job description. An agent reads the full career timeline via MCP and builds a tailored CV from actual entries. No manual rewriting, no "optimized for this role" stretching. Just the data that's relevant, presented straight.

**Content discovery**: Blog posts become machine-searchable. An agent hunting for a technical answer can search across personal site MCPs, find the relevant post, cite it by slug. No scraping, no hallucinated sources.

**Portfolio becomes API**: Your personal site serves data to any agent — not just one chatbot you embedded. The same tools that power the woss.io chat work in OpenCode, Cursor, Claude Desktop, any MCP client. Write once, data works everywhere.

None of this requires trust in the LLM to "be honest." It requires trust in the architecture. Give an agent real data and it makes good decisions. Give it prompts and hope, you get plausible fictions.

## What's Next

woss.io MCP is fully public and read-only — no auth, no sessions, any MCP client can connect and start querying. I'm planning more: granular experience queries, tag-based post filtering, a timeline resource that maps career progression visually.

But the most interesting part is watching agents do things I didn't design for. That's the point of exposing data through MCP. You don't need to predict every question. Just make the data accessible. Agents figure out the rest.

Your personal site's AI doesn't need to be smarter. It needs better data.
