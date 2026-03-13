# Memory Knowledge Graph

Interactive visualization of OpenClaw memory structure — sessions, daily files, digests, knowledge docs, and carry-forwards rendered as a live graph.

## Route

`/memory-graph`

## API

`GET /api/memory/graph`

Returns `{ nodes, edges, stats, generatedAt }`.

### Node Types

| Type | Source | Description |
|------|--------|-------------|
| `daily` | `OPENCLAW_MEMORY_DIR/memory/YYYY-MM-DD.md` | Daily memory files |
| `digest` | `OPENCLAW_MEMORY_DIR/memory/digests/` | Compressed memory digests |
| `knowledge` | `OPENCLAW_MEMORY_DIR/docs/knowledge/` | Long-form knowledge docs |
| `carry-forward` | `OPENCLAW_MEMORY_DIR/config/carry-forwards.json` | Open carry-forward items |
| `agent` | Derived from session agent names | Agent identities |
| `session` | Gateway + local Claude sessions | Individual sessions |

### Edge Types

| Type | From → To | Meaning |
|------|-----------|---------|
| `wrote` | agent → session/daily | Agent produced this file |
| `covers` | digest → daily | Digest covers this daily file |
| `references` | carry-forward → agent | Carry-forward owned by agent |
| `links` | carry-forward → knowledge | Carry-forward references knowledge doc |
| `participated` | session → daily | Session occurred on this date |

### Health Signals

| Signal | Condition |
|--------|-----------|
| `ok` | No issues |
| `stale` | Daily file older than 7 days with no digest |
| `orphaned` | Node with no edges |
| `warning` | Open carry-forward items |
| `missing_digest` | Daily file older than 7 days without a corresponding digest |

### Stats

```ts
{
  totalNodes: number
  totalEdges: number
  staleNodes: number
  orphanedNodes: number
  missingDigestNodes: number
}
```

## Panel Features

- **Type filter** — show/hide node types
- **Health filter** — isolate stale, orphaned, warning, or missing_digest nodes
- **Date range** — defaults to last 30 days; agent and config nodes always shown
- **Search** — filter nodes by label
- **Click to preview** — click any node to open a detail sidebar with metadata

## Files

```
src/app/api/memory/graph/route.ts        — API route
src/components/panels/memory-graph-panel.tsx  — Panel component
```

## Dependencies

Uses `@xyflow/react` v12 (already in `package.json`). No new dependencies added.
