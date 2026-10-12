---
name: plans-directory
description: All plan documents must be saved under plans/ — never repo root, docs/, or .devops/
alwaysApply: true
---

## Plan File Location - MANDATORY

Every plan, roadmap, or planning document (implementation plans, research + plan docs, phase/task breakdowns, feature plans, migration plans) MUST be written under `plans/`:

- Top-level plans: `plans/<topic>.md`
- Feature work: `plans/features/<feature>/` using the existing SPEC/EPIC/tasks structure (see `plans/README.md`)
- NEVER repo root, `docs/`, `.devops/`, `market/docs/`, or any package/app directory
- Updating an existing plan: edit it in place where it lives; if it lives outside `plans/`, move it there first
