import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BusEvent {
  id: string;
  ts: string;
  agent: string;
  type: string;
  message: string;
  data: unknown;
  topic: string | null;
  source: 'bus' | 'bridge';
}

// Raw bus.jsonl line shape
interface RawBusLine {
  ts?: string;
  agent?: string;
  type?: string;
  message?: string;
  data?: unknown;
  topic?: string;
  [key: string]: unknown;
}

// Raw bridge.jsonl line shape
interface RawBridgeLine {
  schema_version?: string;
  id?: string;
  ts?: string;
  direction?: string;
  from?: string;
  type?: string;
  content?: string;
  [key: string]: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolvePath(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * Read the last N lines of a file without loading the whole thing into memory.
 * Falls back to reading all lines for small files.
 */
function tailFile(filePath: string, maxLines: number): string[] {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    return lines.slice(-maxLines);
  } catch (err: any) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Parse bus.jsonl lines into normalized BusEvent objects.
 * Skips malformed lines.
 */
function parseBusLines(lines: string[]): BusEvent[] {
  const events: BusEvent[] = [];
  for (const line of lines) {
    try {
      const raw = JSON.parse(line) as RawBusLine;
      if (!raw.ts) continue; // skip lines without timestamp
      events.push({
        id: `bus-${raw.ts}-${Math.random().toString(36).slice(2, 7)}`,
        ts: raw.ts,
        agent: raw.agent ?? 'unknown',
        type: raw.type ?? 'unknown',
        message: raw.message ?? '',
        data: raw.data ?? null,
        topic: raw.topic ?? null,
        source: 'bus',
      });
    } catch {
      // Malformed JSON — skip silently
    }
  }
  return events;
}

/**
 * Parse bridge.jsonl lines into normalized BusEvent objects.
 * Maps bridge schema onto shared BusEvent shape.
 */
function parseBridgeLines(lines: string[]): BusEvent[] {
  const events: BusEvent[] = [];
  for (const line of lines) {
    try {
      const raw = JSON.parse(line) as RawBridgeLine;
      if (!raw.ts) continue;
      events.push({
        id: raw.id ?? `bridge-${raw.ts}-${Math.random().toString(36).slice(2, 7)}`,
        ts: raw.ts,
        agent: raw.from ?? 'unknown',
        type: raw.type ?? 'unknown',
        // Expose direction in message prefix for clarity
        message: raw.content ?? '',
        data: {
          direction: raw.direction ?? null,
          schema_version: raw.schema_version ?? null,
        },
        topic: raw.direction ?? null,
        source: 'bridge',
      });
    } catch {
      // Malformed JSON — skip silently
    }
  }
  return events;
}

// ─── Route ────────────────────────────────────────────────────────────────────

const BUS_FILE = resolvePath('~/.openclaw/events/bus.jsonl');
const BRIDGE_FILE = resolvePath('~/.openclaw/channels/bridge.jsonl');

const BUS_TAIL = 200;
const BRIDGE_TAIL = 50;

/**
 * GET /api/bus
 * Query params:
 *   source  = bus | bridge | all  (default: all)
 *   limit   = number              (default: 50, max: 500)
 *   since   = ISO timestamp       (optional — return only events after this ts)
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { searchParams } = new URL(request.url);

    const source = (searchParams.get('source') ?? 'all') as 'bus' | 'bridge' | 'all';
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 500);
    const since = searchParams.get('since'); // ISO string or null

    if (!['bus', 'bridge', 'all'].includes(source)) {
      return NextResponse.json(
        { error: 'Invalid source. Must be bus, bridge, or all.' },
        { status: 400 }
      );
    }

    // ── Read files ────────────────────────────────────────────────────────────
    let events: BusEvent[] = [];

    if (source === 'bus' || source === 'all') {
      const busLines = tailFile(BUS_FILE, BUS_TAIL);
      events.push(...parseBusLines(busLines));
    }

    if (source === 'bridge' || source === 'all') {
      const bridgeLines = tailFile(BRIDGE_FILE, BRIDGE_TAIL);
      events.push(...parseBridgeLines(bridgeLines));
    }

    // ── Filter by since ───────────────────────────────────────────────────────
    if (since) {
      const sinceMs = Date.parse(since);
      if (!isNaN(sinceMs)) {
        events = events.filter(e => Date.parse(e.ts) > sinceMs);
      }
    }

    // ── Sort descending by timestamp ──────────────────────────────────────────
    events.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));

    // ── Apply limit ───────────────────────────────────────────────────────────
    events = events.slice(0, limit);

    return NextResponse.json(events);
  } catch (error) {
    logger.error({ err: error }, 'GET /api/bus error');
    return NextResponse.json({ error: 'Failed to read bus events' }, { status: 500 });
  }
}
