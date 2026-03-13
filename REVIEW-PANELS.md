# Mission Control — Panel Component Audit

> Generated: 2026-03-05 | Reviewer: Watson (subagent mc-review-panels)

---

## Summary

| Metric | Value |
|--------|-------|
| Total panel files | 29 |
| Total lines of code | 17,317 |
| Panels active in main page | 27 |
| Panels orphaned/unused directly | 2 (`agent-squad-panel.tsx`, `agent-detail-tabs.tsx` as internal) |
| Panels with silent error catches (no UI) | 5 confirmed |
| Panels using deprecated polling | 3 (`setInterval` instead of `useSmartPoll`) |
| Confirmed duplicate panels | 1 pair (`agent-squad-panel` vs `agent-squad-panel-phase3`) |
| Panels with hardcoded static data | 0 (all fetch from real APIs) |

---

## Line Count by Panel (Smallest → Largest)

| File | Lines | Notes |
|------|-------|-------|
| `notifications-panel.tsx` | 145 | Lean, clean |
| `audit-trail-panel.tsx` | 261 | Fine |
| `agent-spawn-panel.tsx` | 286 | Fine |
| `agent-cost-panel.tsx` | 305 | ⚠️ Silent error (no UI on fetch fail) |
| `agent-history-panel.tsx` | 337 | Fine |
| `activity-feed-panel.tsx` | 349 | Good error handling |
| `log-viewer-panel.tsx` | 350 | Fine |
| `settings-panel.tsx` | 358 | Fine |
| `user-management-panel.tsx` | 386 | Fine |
| `gateway-config-panel.tsx` | 389 | Fine |
| `office-panel.tsx` | 424 | ⚠️ Uses `setInterval` instead of `useSmartPoll` |
| `webhook-panel.tsx` | 437 | Fine |
| `alert-rules-panel.tsx` | 447 | ⚠️ Uses `setInterval` implicitly via plain useEffect |
| `multi-gateway-panel.tsx` | 487 | Fine |
| `session-details-panel.tsx` | 494 | Fine |
| `pipeline-tab.tsx` | 513 | ⚠️ Internal — only used by `orchestration-bar` |
| `github-sync-panel.tsx` | 534 | ⚠️ Silent error (setError=0) |
| `orchestration-bar.tsx` | 564 | ⚠️ Uses `setInterval`; hosts `pipeline-tab` |
| `standup-panel.tsx` | 566 | Fine |
| `agent-squad-panel.tsx` | 621 | 🔴 DEAD CODE — replaced by phase3 |
| `agent-comms-panel.tsx` | 643 | Fine |
| `token-dashboard-panel.tsx` | 643 | 🔴 Silent errors — 3 catches, 0 UI feedback |
| `integrations-panel.tsx` | 651 | Fine |
| `memory-browser-panel.tsx` | 854 | Large but justified (complex browser UI) |
| `cron-management-panel.tsx` | 902 | ⚠️ 7 catches, 0 setError — silent failures |
| `agent-squad-panel-phase3.tsx` | 926 | Active replacement for squad panel |
| `super-admin-panel.tsx` | 972 | Large but justified (multi-tab admin) |
| `task-board-panel.tsx` | 1,668 | 🔴 Bloat candidate — largest panel by 2× |
| `agent-detail-tabs.tsx` | 1,805 | 🔴 Largest file — internal component, not direct panel |

**Total: 17,317 lines across 29 files**

---

## 🔴 Critical Issues

### 1. Dead Code: `agent-squad-panel.tsx` (621 lines)

The old squad panel is **not imported in `page.tsx`**. The app has fully migrated to `agent-squad-panel-phase3.tsx`. The old panel:
- Still uses `setInterval` for polling (10s hardcoded) instead of `useSmartPoll`
- Has 4× fewer `bg-surface` Tailwind uses (4 vs 18) — visually stale
- Has diverged significantly in functionality from phase3

**Action: Delete `agent-squad-panel.tsx`.**

### 2. Extreme Bloat: `task-board-panel.tsx` (1,668 lines)

At 1,668 lines, this is 2× the next-largest top-level panel and ~5× the median. It contains:
- Full drag-and-drop kanban logic
- `useMentionTargets` hook (inline, should be extracted)
- `MentionDropdown` component (inline sub-component, ~90 lines)
- Task create/edit modal logic
- Project manager modal logic
- Quality review badge logic

**Action: Extract `MentionDropdown`, `useMentionTargets`, and modals into separate files. Target: reduce to <900 lines.**

### 3. `agent-detail-tabs.tsx` (1,805 lines) — Misclassified as Panel

This file lives in `/panels/` but it's not a panel — it exports multiple tab sub-components (`OverviewTab`, `SoulTab`, `MemoryTab`, `TasksTab`, `ActivityTab`, `ConfigTab`, `CreateAgentModal`) consumed internally by `agent-squad-panel-phase3.tsx`. It has **0 direct imports from `page.tsx`**.

**Action: Move to `/components/agents/` or `/components/agent-detail/` to clarify it's not a standalone panel.**

### 4. Silent Error Catches (No UI Feedback)

These panels catch errors but never surface them to the user — failures are invisible:

| Panel | Catches | `setError` | UI Feedback |
|-------|---------|-----------|-------------|
| `token-dashboard-panel.tsx` | 3 | 0 | ❌ None |
| `agent-cost-panel.tsx` | 1 | 0 | ❌ None |
| `cron-management-panel.tsx` | 7 | 0 | ❌ None |
| `github-sync-panel.tsx` | 6 | 0 | ❌ None |
| `office-panel.tsx` | 1 | 0 | ❌ None |

`token-dashboard-panel` and `agent-cost-panel` are especially bad — if the `/api/tokens` endpoint is down, the user sees a blank panel with no indication of failure.

**Action: Add `setError` state + an error banner to each. Precedent: `notifications-panel.tsx` is the cleanest model.**

---

## ⚠️ Moderate Issues

### 5. Inconsistent Polling Pattern

10 panels correctly use `useSmartPoll` (pauses when SSE connected, respects visibility). 3 active panels still use raw `setInterval`:

| Panel | Pattern | Issue |
|-------|---------|-------|
| `office-panel.tsx` | `setInterval(fetchAgents, 10000)` | Polls even when SSE active, wastes requests |
| `orchestration-bar.tsx` | `setInterval` | Same issue |
| `agent-squad-panel.tsx` | `setInterval` | Moot — dead code |

**Action: Migrate `office-panel` and `orchestration-bar` to `useSmartPoll`.**

### 6. `pipeline-tab.tsx` — Misclassified Location

`pipeline-tab.tsx` (513 lines) is not a standalone panel. It's only ever rendered inside `orchestration-bar.tsx`. It lives in `/panels/` but is really a sub-component of `orchestration-bar`.

**Action: Either inline into `orchestration-bar.tsx` (if small enough) or move to `/components/orchestration/`. Remove from `/panels/`.**

### 7. Styling Inconsistencies

The predominant card pattern is `bg-card border border-border rounded-lg p-6` (27 instances) but there are 4 competing variants:
- `bg-card border border-border rounded-lg p-4` (6 uses)
- `bg-card rounded-lg p-4 border border-border` (5 uses — same CSS, different order)
- `rounded-xl border border-border bg-card overflow-hidden` (4 uses — uses `rounded-xl` not `rounded-lg`)
- `bg-secondary rounded-lg p-4` (3 uses)

The `rounded-xl` vs `rounded-lg` split is the most visually inconsistent — `agent-squad-panel-phase3` and `task-board-panel` use `rounded-xl` while most others use `rounded-lg`.

Input field styles have similar fragmentation — 5 distinct className patterns for `<input>` elements across the panels.

**Action: Define shared `cn()` variants or Tailwind component classes in a shared `ui/` component. Not urgent but creates visual inconsistency at scale.**

### 8. Token Dashboard ↔ Agent Cost Overlap

`token-dashboard-panel.tsx` (643 lines) and `agent-cost-panel.tsx` (305 lines) both hit `/api/tokens` with different `action=` params. The token dashboard shows model-level breakdown and charts; agent cost shows agent-level breakdown. These are meaningfully different views but:
- Both live as separate nav items
- Both have identical `formatNumber`/`formatCost` helpers duplicated verbatim
- Both use `selectedTimeframe` state with identical `'hour' | 'day' | 'week' | 'month'` type

**Action: Extract shared `useTokenStats(timeframe)` hook and shared formatting utils. Not a merge candidate — they serve different purposes — but they should share code.**

---

## ✅ What's Working Well

- **All panels fetch from real APIs** — no hardcoded fake data. Static arrays like `OPERATORS`, `AVAILABLE_EVENTS`, `statusColumns` are config constants, not fake data.
- **Error handling is broadly present** — 28/29 panels have at least some error state. The 5 silent-catch panels are fixable, not systemic.
- **`useSmartPoll` adoption is solid** — 10/29 panels use it, covering the highest-traffic panels (activity feed, squad, task board, comms).
- **`createClientLogger` is universal** — every panel uses the consistent logging pattern.
- **No lorem ipsum, no `Math.random()` fake IDs** — the one `Math.random()` in `agent-spawn-panel` is a legitimate spawn ID generator, not fake data.
- **`ErrorBoundary` wraps all panels at the page level** — catastrophic crashes are caught even when panels don't handle errors internally.

---

## Recommendations Summary

| Priority | Action | Panel(s) | Effort |
|----------|--------|----------|--------|
| P0 | **Delete** dead panel | `agent-squad-panel.tsx` | 5 min |
| P1 | **Add error UI** for silent catches | `token-dashboard`, `agent-cost`, `cron-management`, `github-sync`, `office` | 1h |
| P1 | **Extract sub-components** from task-board | `task-board-panel.tsx` | 2h |
| P2 | **Relocate** misclassified files | `agent-detail-tabs.tsx` → `/agents/`, `pipeline-tab.tsx` → `/orchestration/` | 30 min |
| P2 | **Migrate polling** to `useSmartPoll` | `office-panel`, `orchestration-bar` | 1h |
| P3 | **Extract shared hooks/utils** | `token-dashboard` + `agent-cost` → shared `useTokenStats` | 1h |
| P3 | **Standardize card radius** | All panels (`rounded-xl` → `rounded-lg` or vice versa) | 30 min |

---

## Files to Delete

```
src/components/panels/agent-squad-panel.tsx   # 621 lines of dead code
```

## Files to Relocate

```
src/components/panels/agent-detail-tabs.tsx   → src/components/agents/agent-detail-tabs.tsx
src/components/panels/pipeline-tab.tsx        → src/components/orchestration/pipeline-tab.tsx
```

---

*Audit conducted by Watson subagent `mc-review-panels` on 2026-03-05.*
*Full panel list: 29 files, 17,317 total lines.*
