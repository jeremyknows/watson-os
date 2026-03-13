import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Thread {
  id: string;
  project: string;
  description: string;
  opened: string;
  status: string;
  channel?: string;
  notes?: string;
  blocker?: string;
}

interface ThreadsFile {
  _comment?: string;
  _convention?: string;
  _updated?: string;
  threads: Thread[];
  _retire_candidates?: unknown[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolvePath(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

// ─── Route ────────────────────────────────────────────────────────────────────

const THREADS_FILE = resolvePath('~/.openclaw/agents/main/workspace/config/active-threads.json');

/**
 * GET /api/watson/threads
 * Returns the active threads from Watson's config
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    // Check if file exists
    if (!fs.existsSync(THREADS_FILE)) {
      return NextResponse.json({
        threads: [],
        updated: 'unknown',
        error: 'Threads file not found',
      });
    }

    // Read and parse the file
    const content = fs.readFileSync(THREADS_FILE, 'utf8');
    const data = JSON.parse(content) as ThreadsFile;

    // Return threads with metadata
    return NextResponse.json({
      threads: data.threads || [],
      updated: data._updated || 'unknown',
    });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/watson/threads error');
    return NextResponse.json({ error: 'Failed to read threads file' }, { status: 500 });
  }
}
