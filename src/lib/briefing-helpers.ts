/**
 * Shared helpers for briefing and awareness endpoints.
 * Extracted from the briefing route to enable reuse.
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { config } from './config'

// ── Types ────────────────────────────────────────────────────────────────────

export interface CronJob {
  id?: string
  name?: string
  agentId?: string
  enabled?: boolean
  state?: {
    consecutiveErrors?: number
    lastError?: string
    lastStatus?: string
    lastRunAtMs?: number
    nextRunAtMs?: number
    lastRunStatus?: string
  }
}

export interface BusEvent {
  ts?: string
  agent?: string
  type?: string
  message?: string
  data?: Record<string, unknown>
}

// ── Path Helpers ─────────────────────────────────────────────────────────────

export function getWorkspacePath(): string {
  return path.join(config.openclawStateDir, 'agents', 'main', 'workspace')
}

// ── Cron Jobs ────────────────────────────────────────────────────────────────

export async function loadCronJobs(): Promise<CronJob[]> {
  const cronPath = path.join(config.openclawStateDir, 'cron', 'jobs.json')
  try {
    const raw = await readFile(cronPath, 'utf-8')
    const data = JSON.parse(raw)
    return data.jobs || (Array.isArray(data) ? data : [])
  } catch {
    return []
  }
}

// ── Bus Events ───────────────────────────────────────────────────────────────

export async function readBusEvents(limit: number = 200): Promise<BusEvent[]> {
  const busPath = path.join(config.openclawStateDir, 'events', 'bus.jsonl')
  const events: BusEvent[] = []

  try {
    const raw = await readFile(busPath, 'utf-8')
    const lines = raw.trim().split('\n').filter(l => l.trim())
    const lastN = lines.slice(-limit)

    for (const line of lastN) {
      try {
        events.push(JSON.parse(line))
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // File doesn't exist
  }

  return events
}

// ── Breaker Flag ─────────────────────────────────────────────────────────────

export interface BreakerFlag {
  tripped: boolean
  reason?: string
  trippedAt?: string
}

export async function readBreakerFlag(): Promise<BreakerFlag> {
  const flagPath = path.join(getWorkspacePath(), 'apps', 'watson-os', 'routes', 'breaker-tripped.flag')
  try {
    const content = await readFile(flagPath, 'utf-8')
    const data = JSON.parse(content)
    return {
      tripped: true,
      reason: data.reason || 'unknown',
      trippedAt: data.trippedAt,
    }
  } catch {
    return { tripped: false }
  }
}

// ── Tasks ────────────────────────────────────────────────────────────────────

export interface TaskItem {
  id?: string
  text?: string
  priority?: string
  status?: string
  created_at?: string
}

export interface TasksData {
  pending: TaskItem[]
  carry_forward: TaskItem[]
}

export async function loadTasks(): Promise<TasksData> {
  const tasksPath = path.join(getWorkspacePath(), 'apps', 'watson-os', 'tasks.json')
  try {
    const raw = await readFile(tasksPath, 'utf-8')
    const data = JSON.parse(raw)
    return {
      pending: data.pending || [],
      carry_forward: data.carry_forward || [],
    }
  } catch {
    return { pending: [], carry_forward: [] }
  }
}

// ── Context Hints ────────────────────────────────────────────────────────────

export async function loadContextHints(): Promise<string[]> {
  const hintsPath = path.join(getWorkspacePath(), 'apps', 'watson-os', 'context-hints.txt')
  try {
    const content = await readFile(hintsPath, 'utf-8')
    return content
      .trim()
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
  } catch {
    return []
  }
}
