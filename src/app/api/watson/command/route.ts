import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BridgeMessage {
  schema_version: string;
  id: string;
  ts: string;
  direction: string;
  from: string;
  type: string;
  content: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolvePath(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

// ─── Route ────────────────────────────────────────────────────────────────────

const BRIDGE_FILE = resolvePath('~/.openclaw/channels/bridge.jsonl');

/**
 * POST /api/watson/command
 * Sends a command to Watson via the CC Bridge
 *
 * Body:
 *   content: string - The command/task content
 *   type?: string - Message type (default: 'task')
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    const { content, type = 'task' } = body;

    if (!content || typeof content !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid content field' },
        { status: 400 }
      );
    }

    // Generate unique message ID
    const messageId = `wcc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // Create the bridge message
    const message: BridgeMessage = {
      schema_version: '1',
      id: messageId,
      ts: new Date().toISOString(),
      direction: 'to-watson',
      from: 'mission-control',
      type,
      content: content.trim(),
    };

    // Ensure the channels directory exists
    const channelsDir = path.dirname(BRIDGE_FILE);
    if (!fs.existsSync(channelsDir)) {
      fs.mkdirSync(channelsDir, { recursive: true });
    }

    // Append to bridge.jsonl
    const line = JSON.stringify(message) + '\n';
    fs.appendFileSync(BRIDGE_FILE, line, 'utf8');

    logger.info({ messageId, type }, 'Command sent to Watson via bridge');

    return NextResponse.json({
      success: true,
      messageId,
      ts: message.ts,
    });
  } catch (error) {
    logger.error({ err: error }, 'POST /api/watson/command error');
    return NextResponse.json({ error: 'Failed to send command' }, { status: 500 });
  }
}
