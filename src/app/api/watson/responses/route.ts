import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawBridgeLine {
  schema_version?: string;
  id?: string;
  ts?: string;
  direction?: string;
  from?: string;
  type?: string;
  content?: string;
  ref?: string;
  [key: string]: unknown;
}

interface BridgeResponse {
  id: string;
  ts: string;
  direction: string | null;
  from: string;
  type: string;
  content: string;
  ref?: string;
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

// ─── Route ────────────────────────────────────────────────────────────────────

const BRIDGE_FILE = resolvePath('~/.openclaw/channels/bridge.jsonl');
const MAX_LINES = 100;

/**
 * GET /api/watson/responses
 * Reads bridge.jsonl for responses (direction=to-claude) from Watson
 *
 * Query params:
 *   since?: string - ISO timestamp, only return responses newer than this
 *   limit?: number - Max responses to return (default: 20)
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { searchParams } = new URL(request.url);
    const since = searchParams.get('since');
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100);

    // Read recent lines from bridge file
    const lines = tailFile(BRIDGE_FILE, MAX_LINES);

    // Parse and filter for Watson responses
    const responses: BridgeResponse[] = [];
    for (const line of lines) {
      try {
        const raw = JSON.parse(line) as RawBridgeLine;
        if (!raw.ts) continue;

        // Filter for responses from Watson (direction=to-claude or from=watson)
        const isWatsonResponse = raw.direction === 'to-claude' || raw.from === 'watson';
        if (!isWatsonResponse) continue;

        // Filter by since timestamp if provided
        if (since) {
          const sinceMs = Date.parse(since);
          if (!isNaN(sinceMs) && Date.parse(raw.ts) <= sinceMs) {
            continue;
          }
        }

        responses.push({
          id: raw.id ?? `bridge-${raw.ts}-${Math.random().toString(36).slice(2, 7)}`,
          ts: raw.ts,
          direction: raw.direction ?? null,
          from: raw.from ?? 'unknown',
          type: raw.type ?? 'unknown',
          content: raw.content ?? '',
          ref: raw.ref,
        });
      } catch {
        // Malformed JSON — skip
      }
    }

    // Sort newest first and apply limit
    responses.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
    const limited = responses.slice(0, limit);

    return NextResponse.json({
      responses: limited,
      count: limited.length,
      total: responses.length,
    });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/watson/responses error');
    return NextResponse.json({ error: 'Failed to read responses' }, { status: 500 });
  }
}
