# PROJECT.md
Last updated: 2026-03-13 (commit eabdb6e)

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

- Upstream: https://github.com/builderz-labs/mission-control (v2 baseline)
- Upstream remote configured: `git remote -v` shows builderz-labs/mission-control
- Current state: **Fresh clone from v2 with Watson integrations ported**
- Last synced: 2026-03-13
- No drift — clean baseline for future updates

## Constraints

- Local-only: no Vercel, no public deploy
- SQLite for persistence (not Supabase — that's JHQ's backend)
- Lock files always escalate to Watson before merge
- No .env files in context ever

## Current State

Fresh v2 baseline from builderz-labs/mission-control. Watson-specific APIs and panels ported. pnpm install complete. WatsonFlow not yet built.

Key files migrated:
- APIs: briefing, bus, awareness, discord, watson/*, v5-brief
- Panels: watson-command-center, watson-intelligence-feed
- Helpers: briefing-helpers.ts
- Scripts: seed-activities-from-bus, agent-heartbeat, notification-daemon

Server ready to start with `pnpm dev`.

## Sprint

First sprint: project orientation + fork decision.
Next action: awaiting fork decision from Jeremy/Watson (see FORK-DECISION.md).

## Known Issues

- 213 commits behind upstream v2.0.0 — significant drift
- Local server not currently running
- No active maintenance since initial setup
