import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { logger } from '@/lib/logger';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedUser {
  name?: string;
  timezone?: string;
  email?: string;
  background?: string[];
  work?: string[];
  communication?: string[];
  tools?: string[];
  trust?: string[];
}

interface ParsedSoul {
  coreTruths?: string[];
  boundaries?: string[];
  vibe?: string;
  visualIdentity?: string;
}

interface ParsedIdentity {
  name?: string;
  creature?: string;
  vibe?: string;
  emoji?: string;
  avatar?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolvePath(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

function readFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function extractKeyValue(content: string, key: string): string | undefined {
  // Match **Key:** value pattern
  const regex = new RegExp(`\\*\\*${key}:\\*\\*\\s*(.+)`, 'i');
  const match = content.match(regex);
  return match ? match[1].trim() : undefined;
}

function extractListItems(content: string, sectionHeader: string): string[] {
  const items: string[] = [];
  const lines = content.split('\n');
  let inSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Check if we hit a section header
    if (trimmed.startsWith('## ') || trimmed.startsWith('# ')) {
      if (trimmed.toLowerCase().includes(sectionHeader.toLowerCase())) {
        inSection = true;
        continue;
      } else if (inSection) {
        // Hit another section, stop collecting
        break;
      }
    }

    // Collect list items in the section
    if (inSection && (trimmed.startsWith('- ') || trimmed.startsWith('* '))) {
      items.push(trimmed.slice(2));
    }
  }

  return items.slice(0, 10); // Limit to 10 items
}

function parseUserMd(content: string): ParsedUser {
  return {
    name: extractKeyValue(content, 'Name') || extractKeyValue(content, 'What to call them'),
    timezone: extractKeyValue(content, 'Timezone'),
    email: extractKeyValue(content, 'Email'),
    background: extractListItems(content, 'Background'),
    work: extractListItems(content, 'Work'),
    communication: extractListItems(content, 'Communication'),
    tools: extractListItems(content, 'Tools'),
    trust: extractListItems(content, 'Trust'),
  };
}

function parseSoulMd(content: string): ParsedSoul {
  // Extract "Vibe" paragraph
  const vibeMatch = content.match(/## Vibe\s*\n+([\s\S]*?)(?=\n## |$)/);
  const vibe = vibeMatch ? vibeMatch[1].trim().split('\n')[0] : undefined;

  // Extract visual identity
  const visualMatch = content.match(/## Visual Identity\s*\n+([\s\S]*?)(?=\n## |$)/);
  const visualIdentity = visualMatch ? visualMatch[1].trim().split('\n').slice(0, 2).join(' ') : undefined;

  return {
    coreTruths: extractListItems(content, 'Core Truths'),
    boundaries: extractListItems(content, 'Boundaries'),
    vibe,
    visualIdentity,
  };
}

function parseIdentityMd(content: string): ParsedIdentity {
  return {
    name: extractKeyValue(content, 'Name'),
    creature: extractKeyValue(content, 'Creature'),
    vibe: extractKeyValue(content, 'Vibe'),
    emoji: extractKeyValue(content, 'Emoji'),
    avatar: extractKeyValue(content, 'Avatar'),
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────

const WORKSPACE_DIR = resolvePath('~/.openclaw/agents/main/workspace');
const USER_FILE = path.join(WORKSPACE_DIR, 'USER.md');
const SOUL_FILE = path.join(WORKSPACE_DIR, 'SOUL.md');
const IDENTITY_FILE = path.join(WORKSPACE_DIR, 'IDENTITY.md');

/**
 * GET /api/watson/personality
 * Returns Watson's personality configuration from USER.md, SOUL.md, and IDENTITY.md
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer');
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const userContent = readFile(USER_FILE) || '';
    const soulContent = readFile(SOUL_FILE) || '';
    const identityContent = readFile(IDENTITY_FILE) || '';

    return NextResponse.json({
      user: {
        raw: userContent,
        parsed: parseUserMd(userContent),
      },
      soul: {
        raw: soulContent,
        sections: parseSoulMd(soulContent),
      },
      identity: {
        raw: identityContent,
        parsed: parseIdentityMd(identityContent),
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'GET /api/watson/personality error');
    return NextResponse.json({ error: 'Failed to read personality files' }, { status: 500 });
  }
}
