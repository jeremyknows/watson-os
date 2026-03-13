# Watson Wiring Audit — Mission Control
**Date:** 2026-03-05  
**Auditor:** Watson subagent (mc-review-wiring)  
**Scope:** Real vs hardcoded integration between Mission Control and the OpenClaw/Watson system

---

## TL;DR

Mission Control is substantially wired to real OpenClaw data. The core reading paths (cron jobs, sessions, agent configs, memory, logs) all hit real files. The main gaps are the absence of **bus.jsonl** and **bridge.jsonl** integration — these are the two files that would make the "Watson Intelligence Feed" panel actually real-time and aware. Active-threads.json is also completely unread.

---

## 1. Gateway Status

**Status: REAL connection to live OpenClaw gateway**

```
POST /api/gateways/health
→ { "id": 1, "name": "primary", "status": "online", "latency": 12ms, "gateway_version": null }
```

- Gateway is at `127.0.0.1:18789` (stored in SQLite `gateways` table)
- Health probe is a real HTTP fetch — **not a stub**
- `gateway_version` returns `null` because the gateway doesn't set an `x-openclaw-version` or `x-clawdbot-version` response header — minor cosmetic issue
- Sessions endpoint uses `getAllGatewaySessions()` which reads real files at `~/.openclaw/agents/*/sessions/sessions.json` — **confirmed real**
- `/api/sessions` returned 4 live sessions sourced from gateway disk files (`source: "gateway"`)

---

## 2. Agent Data Source

**Status: HYBRID — openclaw.json + DB**

- `/api/agents` returns **4 agents** from the MC SQLite database
- Agent data is synced FROM `~/.openclaw/openclaw.json` via `/api/agents/sync`  
  (`lib/agent-sync.ts → readFileSync(openclawConfigPath)`)
- Soul content is read from each agent's workspace `soul.md` file at sync time
- `enrichAgentConfigFromWorkspace()` reads `identity.md` and `TOOLS.md` from agent workspaces
- **The DB is the live serving layer; openclaw.json is the source of truth for sync**
- Soul detection: agent list returns `soul={True/False}` — Watson's main agent should have soul content if synced

**Gap:** Sync is manual (POST `/api/agents/sync`) — not automatic on openclaw.json change.

---

## 3. Endpoints That Read Real OpenClaw Files

| Endpoint | File(s) Read | Notes |
|----------|-------------|-------|
| `GET /api/cron?action=list` | `~/.openclaw/cron/jobs.json` | ✅ **Fully functional** — 65 real jobs returned |
| `GET /api/sessions` | `~/.openclaw/agents/*/sessions/sessions.json` | ✅ Live session data |
| `GET /api/memory?action=tree` | `~/.openclaw/agents/` (entire tree) | ✅ Traverses all agent workspaces |
| `GET /api/memory?action=content` | Any file under memoryDir | ✅ With path-escape protection |
| `GET /api/logs` | `~/.openclaw/logs/` | ✅ Reads actual log files |
| `GET /api/agents` (via sync) | `~/.openclaw/openclaw.json` + workspace files | ✅ Source of truth for agent configs |
| `POST /api/agents/sync` | `~/.openclaw/openclaw.json` | ✅ Full bidirectional sync |
| `GET /api/integrations` | `~/.openclaw/openclaw.json` (env vars) | ✅ Reads integration config |
| `POST /api/cron` (toggle/remove/add) | `~/.openclaw/cron/jobs.json` | ✅ Read + write |
| `GET/POST /api/gateway-config` | `~/.openclaw/openclaw.json` | ✅ Live config editing |

---

## 4. Endpoints That SHOULD Read OpenClaw Files But Don't

### 4a. `~/.openclaw/events/bus.jsonl` — **NOT READ ANYWHERE**

**File exists:** `~/.openclaw/events/bus.jsonl` ✅  
**Read in MC:** ❌ Zero references in the entire codebase

The event bus is the heartbeat of the Watson system. Every agent action, cron completion, carry-forward, and decision is emitted here. MC's `event-bus.ts` and `/api/events` SSE stream is a **purely internal MC construct** — it only broadcasts DB mutations within MC itself, it has no connection to Watson's actual activity stream.

**Recommendation:**  
Create `/api/bus` endpoint that:
1. Tails `~/.openclaw/events/bus.jsonl` (last N lines on GET)
2. Optionally streams new lines via SSE (tail -f equivalent)
3. Feeds a "Watson Activity" panel with real agent events
4. Could bridge into `eventBus.emit('server-event')` so existing SSE clients pick up Watson events automatically

---

### 4b. `~/.openclaw/channels/bridge.jsonl` — **NOT READ ANYWHERE**

**File exists:** `~/.openclaw/channels/bridge.jsonl` ✅  
**Read in MC:** ❌ Zero references

The Claude Code ↔ Watson bridge file is completely invisible to Mission Control. Messages with `direction: "to-watson"` or `direction: "to-claude"` pass through this file with no MC visibility.

**Recommendation:**  
Create `/api/bridge` endpoint that reads the last N entries from bridge.jsonl and surfaces them in the dashboard. A "CC Bridge" panel would show:
- Pending `to-watson` messages (unacknowledged)
- Recent `to-claude` responses
- Useful for debugging Claude Code ↔ Watson handoffs

---

### 4c. `~/.openclaw/agents/main/workspace/config/active-threads.json` — **NOT READ ANYWHERE**

**File exists:** `~/.openclaw/agents/main/workspace/config/active-threads.json` ✅  
**Read in MC:** ❌ Zero references

The thread registry tracks all open build/feature/sprint Discord threads. This is exactly the kind of data the "Watson Intelligence Feed" panel needs — knowing what active work streams are in flight.

**Recommendation:**  
Add to `/api/status?action=overview` or a dedicated `/api/watson-context` endpoint:
- Read `config/active-threads.json`
- Expose thread count, active projects, stale threads (>3d old)

---

### 4d. `~/.openclaw/agents/main/workspace/memory/` — **Partially Accessible**

**What works:** `/api/memory?action=tree` traverses `~/.openclaw/agents/` and DOES show Watson's workspace memory at `main/workspace/memory/`. The path is accessible.

**What's missing:** The Memory Browser panel presents a tree of all agent workspaces — but there's no quick "Today's Watson log" shortcut or highlighted view. The daily memory file (`memory/YYYY-MM-DD.md`) isn't surfaced prominently.

**Recommendation:** Surface `main/workspace/memory/YYYY-MM-DD.md` (today's file) as a featured read in any "Watson Intelligence Feed" panel.

---

## 5. Cron Endpoint Diagnosis

**Why `GET /api/cron` returns "Invalid action":**

The cron route requires `?action=list` parameter. A bare `GET /api/cron` (no action param) falls through to:
```typescript
return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
```

This is by design — all valid actions require explicit params:
- `GET /api/cron?action=list` → ✅ Returns 65 real jobs from `~/.openclaw/cron/jobs.json`
- `GET /api/cron?action=logs&job=<id>` → ✅ Returns job state info

**The cron panel in the UI must be passing `?action=list`** — this is a client-side correct pattern, not a bug. The bare endpoint "failure" is just an unguarded default.

**Minor issue:** `GET /api/cron` with no action should probably return `{ jobs: [] }` with 200 or redirect to `action=list`, since a bare GET is a common curl/debugging pattern.

---

## 6. Sessions Endpoint Diagnosis

**Status: FULLY FUNCTIONAL — reading live gateway files**

`GET /api/sessions` returned 4 real sessions:
- `agent:main:discord:channel:1024127507055775808` — main chat session (Gemini Flash, 170k tokens)
- `agent:main:subagent:*` — 3 active subagent sessions

**Source:** `getAllGatewaySessions()` in `lib/sessions.ts` reads `~/.openclaw/agents/*/sessions/sessions.json` directly from disk — this is real session data, not DB-only.

**Deduplication logic** (#80 fix) is in place: keeps most-recently-updated entry per sessionId.

**Known gap:** `model` shows empty string for subagent sessions (`"model": ""`). This is because subagent session entries don't have a populated `model` field in the sessions.json store until the session completes or sends its first turn.

---

## 7. Missing Integrations for Watson Intelligence Feed Panel

The "Watson Intelligence Feed" panel (if it exists or is planned) would need these integrations that are currently absent:

### High Priority (Real Watson Awareness)

| Missing Integration | File to Read | Why It Matters |
|--------------------|-------------|----------------|
| **Event Bus Reader** | `~/.openclaw/events/bus.jsonl` | Real-time Watson activity — every agent action, cron run, decision |
| **Bus SSE Bridge** | `~/.openclaw/events/bus.jsonl` (tail) | Live-stream new events to dashboard without polling |
| **Active Thread Registry** | `config/active-threads.json` | Know what builds/sprints are in flight |
| **Claude Bridge Status** | `~/.openclaw/channels/bridge.jsonl` | CC ↔ Watson message queue visibility |

### Medium Priority (Intelligence Enrichment)

| Missing Integration | File/API | Why It Matters |
|--------------------|---------|----------------|
| **Today's Daily Memory** | `main/workspace/memory/YYYY-MM-DD.md` | Quick surface of Watson's running log |
| **Briefing Endpoint** | `http://localhost:8989/api/briefing` | JHQ attention level — drives what Watson acts on first |
| **Mailbox Status** | `~/.openclaw/mailbox/to-watson/` | Unread messages, pending approvals |
| **Carry-Forward Items** | Bus events with topic `carry-forward` | What's promised but not done |

### Low Priority (Nice to Have)

| Missing Integration | Notes |
|--------------------|-------|
| Auto-sync agents on openclaw.json change | File watcher on openclawConfigPath |
| Bus event → MC activity ingestion | Write bus events to `activities` table for persistence |
| Thread health check | Flag active-threads.json entries stale >3d |

---

## 8. Summary Score

| Category | Status | Score |
|----------|--------|-------|
| Gateway connection | Real HTTP probe to local gateway | ✅ |
| Session data | Reads live disk files | ✅ |
| Cron jobs | Reads/writes real jobs.json | ✅ |
| Agent configs | Syncs from openclaw.json | ✅ |
| Memory browser | Reads workspace files | ✅ |
| Log viewer | Reads openclaw logs dir | ✅ |
| Event bus (bus.jsonl) | **Not connected** | ❌ |
| CC Bridge (bridge.jsonl) | **Not connected** | ❌ |
| Active thread registry | **Not connected** | ❌ |
| Briefing/JHQ awareness | **Not connected** | ❌ |
| Real-time Watson events | MC-internal only, no Watson data | ❌ |

**Overall: 6/11 wired. Core operational data is real. Intelligence/awareness layer is missing.**

---

## Appendix: Key Config Paths

MC derives all paths from `lib/config.ts`:
- `openclawStateDir` → `~/.openclaw` (auto-detected via `os.homedir()`)
- `openclawConfigPath` → `~/.openclaw/openclaw.json`
- `openclawWorkspaceDir` → `~/.openclaw/workspace` (legacy) or env override
- `memoryDir` → `~/.openclaw/agents` (because `~/.openclaw/agents/main/workspace/memory` exists)
- `logsDir` → `~/.openclaw/logs`
- `openclawBin` → `openclaw` (from PATH)

All paths correctly resolve to real files. No hardcoded stubs detected in the config layer.
