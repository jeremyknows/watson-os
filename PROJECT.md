# PROJECT.md
Last updated: 2026-03-13 (commit 1309563)

Project: Watson OS
Repo: ~/projects/watson-os | jeremyknows/watson-os
Live: LOCAL ONLY — http://localhost:3000 (not deployed to Vercel or any public host)
Stack: Next.js 16 (App Router), TypeScript, SQLite (via builderz-labs origin), PWA

## What This Is

Watson OS is the **local-only** operational dashboard running on Jeremy's Mac Mini.
It is derived from builderz-labs/mission-control (v1.x baseline) with Watson-specific
customizations. It is NOT JHQ. It is NOT deployed remotely.

**DO NOT confuse with JHQ** (jeremyknows/JHQ) — that is a separate Vercel-deployed app.
See: ~/projects/jhq/

## Upstream Relationship

- Upstream: https://github.com/builderz-labs/mission-control
- Upstream remote already configured: `git remote -v` shows it
- Current state: **3 commits ahead, 213 commits behind upstream**
- Upstream shipped v2.0.0 on 2026-03-11 (189 commits, major rewrite)
- We are effectively on a v1.x snapshot with 3 local patches

## Constraints

- Local-only: no Vercel, no public deploy
- SQLite for persistence (not Supabase — that's JHQ's backend)
- Lock files always escalate to Watson before merge
- No .env files in context ever

## Current State

Repo has only 3 commits total:
1. `b8d5466` — initial commit (watson-os Next.js dashboard)
2. `33bf36c` — docs: memory knowledge graph panel
3. `1309563` — fix: escape apostrophes in JSX (lint)

Server is currently down (not running). Needs `pnpm start` or `pnpm dev` to bring up.

## Sprint

First sprint: project orientation + fork decision.
Next action: awaiting fork decision from Jeremy/Watson (see FORK-DECISION.md).

## Known Issues

- 213 commits behind upstream v2.0.0 — significant drift
- Local server not currently running
- No active maintenance since initial setup
