# Projects Folder Audit
Generated: 2026-03-13 by Builder

This file is for Watson to review. Pass to Watson main with: "What do we do with this?"

---

## The Confusion, Mapped

### ~/projects/watson-os  ← THIS IS OUR WORKSPACE (Builder's channel)
- Git: jeremyknows/watson-os
- Upstream remote: builderz-labs/mission-control (already configured)
- Status: Next.js 16 app, SQLite, LOCAL ONLY, 3 commits total, 213 behind upstream v2.0.0
- Last commit: 2026-03-11
- **This is Watson OS — local ops dashboard**

### ~/projects/jhq  ← SEPARATE APP, NOT BUILDER'S CONCERN IN THIS CHANNEL
- Git: jeremyknows/JHQ
- Status: Next.js 15 app, Supabase backend, VERCEL DEPLOYED at https://jhq.vercel.app
- Last commit: 2026-03-12
- Symlinked at: ~/.openclaw/agents/main/workspace/projects/jhq
- **This is the remote-only dashboard. Completely separate from Watson OS.**

### ~/projects/mission-control  ← UPSTREAM SOURCE, NOT OUR CODE
- Git: builderz-labs/mission-control (the OSS repo itself cloned locally)
- Status: Currently at v2.0.0 (latest upstream), 3 commits ahead of what we forked from
- **This is just a local clone of the upstream. Reference only.**

### ~/projects/WatsonOS (no dash)  ← WATSON'S SCRIPTS/INFRA, NOT A DASHBOARD APP
- Git: jeremyknows/WatsonOS
- Content: agents/, scripts/, templates/ — no Next.js app, no package.json
- This is the OpenClaw operational scripts repo, not a dashboard
- Symlinked nowhere in ~/.openclaw currently
- **Watson main should clarify if this is still needed or should be archived**

---

## What's Clear

| Folder | What it is | Keep? |
|--------|-----------|-------|
| `watson-os` | Next.js local dashboard (Builder's home) | ✅ YES |
| `jhq` | Vercel remote dashboard | ✅ YES (separate project) |
| `mission-control` | OSS upstream clone | ⚠️ Reference only — could delete after fork decision |
| `WatsonOS` (no dash) | Agent scripts/infra repo | ❓ Watson to decide |
| `autoresearch` | Standalone tool, not an app | ✅ Fine as-is |
| `brief-builder` | Mini-app, linked from VF Ops Hub | ✅ Fine as-is |
| `s2-upgrades` | Mini-app, linked from VF Ops Hub | ✅ Fine as-is |
| `treasure-chest-planning` | Mini-app, linked from VF Ops Hub | ✅ Fine as-is |
| `content-condor` | Standalone app (Compass agent owns) | ✅ Fine as-is |
| `rescue-bot` | Standalone bot, lives outside OpenClaw | ✅ Fine as-is |
| `veefriends-analytics` | App linked from VF Ops Hub | ✅ Fine as-is |
| `vf-ops-hub` | Hub that links mini-apps | ✅ Fine as-is |

---

## The JHQ vs Watson-OS Rule (never confuse again)

| | Watson OS | JHQ |
|--|-----------|-----|
| Repo | jeremyknows/watson-os | jeremyknows/JHQ |
| Local path | ~/projects/watson-os | ~/projects/jhq |
| Deploy | LOCAL ONLY (localhost:3000) | Vercel (jhq.vercel.app) |
| Backend | SQLite | Supabase |
| Next.js | 16 | 15 |
| Purpose | Ops dashboard for local OpenClaw | Remote personal dashboard |
| Builder channel | #builder-watson-os | N/A (Watson main owns) |

---

## Action Items for Watson

1. **WatsonOS (no dash)** — what is this repo for? Active? Archive it?
2. **mission-control clone** — can it be deleted locally once fork decision is made?
3. **Confirm**: is jhq symlink at ~/.openclaw/agents/main/workspace/projects/jhq intentional and maintained?

---

## Fork Decision (still open — Builder's recommendation)

Watson OS is **213 commits behind** upstream v2.0.0. Key v2 features we're missing:
- Dual-mode operation (local + gateway)
- Hermes observability (sessions, memory, tasks, cron, transcripts)
- Memory panel redesign (Obsidian-style knowledge graph)
- Onboarding + security scan + doctor workflows
- Standalone deploy hardening

**Options:**
1. **Proper GitHub fork** — Fork jeremyknows/watson-os FROM builderz-labs/mission-control on GitHub, then attempt to rebase/cherry-pick our 3 local patches onto v2. Clean history, upstream pulls work.
2. **Selective cherry-pick** — Stay as-is, manually pull specific v2 features we want. No merge complexity.
3. **Fresh start on v2** — Clone v2 clean, re-apply our 3 local customizations (they're small), delete the old repo. Cleanest.

**Builder recommends Option 3** — we only have 3 commits of custom work. A fresh v2 clone + re-applying those patches is a 1-hour job. We get the full v2 foundation, clean history, and upstream pulls work going forward. The 3 custom commits are small enough to port manually.

This needs Jeremy sign-off before any action.
