/**
 * /api/awareness — Watson's session startup blob.
 *
 * Live Agent Awareness endpoint aggregating all operational state:
 * - System health (RAM, gateway status)
 * - Active sessions
 * - Cron health
 * - Memory health
 * - Tasks
 * - Context hints
 * - Alerts (critical/warning/info)
 */

import { NextRequest, NextResponse } from 'next/server'
import { execSync } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import {
  loadCronJobs,
  readBreakerFlag,
  loadTasks,
  loadContextHints,
  getWorkspacePath,
  type CronJob,
} from '@/lib/briefing-helpers'

// ── Types ────────────────────────────────────────────────────────────────────

interface AwarenessResult {
  timestamp: string
  version: number
  alerts: { critical: string[]; warning: string[]; info: string[] }
  system: {
    ram_mb?: number
    ram_gb?: number
    ram_status?: string
    total_gb?: number
    used_gb?: number
    gateway?: 'running' | 'stopped' | 'unknown'
    error?: string
  }
  agents: {
    active_sessions?: number
    sessions?: { key: string; age_min: number; label: string }[]
    orphan_count?: number
    error?: string
  }
  crons: {
    total?: number
    healthy?: number
    failing?: number
    failing_jobs?: {
      id: string
      name: string
      consecutive_errors: number
      last_error: string
    }[]
    next_run?: { name: string; in_minutes: number } | null
    error?: string
  }
  memory: {
    today_file?: string
    today_entries?: number
    last_write?: string
    last_write_age_min?: number
    stale?: boolean
    last_checkpoint?: string
    error?: string
  }
  tasks: { pending: unknown[]; carry_forward: unknown[] }
  context_hints: string[]
  meta: { sources: string[]; generated_in_ms?: number }
}

// ── RAM via vm_stat (macOS) ──────────────────────────────────────────────────

interface RamStats {
  totalGB: number
  usedGB: number
  freeGB: number
  source: string
  error?: string
}

function getRam(): RamStats {
  try {
    const out = execSync('vm_stat', { encoding: 'utf-8', timeout: 5000 })
    let pageSize = 16384 // default macOS page size in bytes (16KB)

    // Try to get actual page size
    const psMatch = out.match(/page size of (\d+) bytes/)
    if (psMatch) {
      pageSize = parseInt(psMatch[1], 10)
    }

    const pages = (label: string): number => {
      const m = out.match(new RegExp(`${label}:\\s+(\\d+)`))
      return m ? parseInt(m[1], 10) : 0
    }

    const free = pages('Pages free')
    const active = pages('Pages active')
    const inactive = pages('Pages inactive')
    const wired = pages('Pages wired down')
    const compressed = pages('Pages occupied by compressor')

    const totalPages = free + active + inactive + wired + compressed
    const usedPages = active + wired + compressed

    const toGB = (p: number) => Math.round((p * pageSize) / (1024 ** 3) * 100) / 100
    const totalGB = toGB(totalPages)
    const usedGB = toGB(usedPages)
    const freeGB = toGB(free + inactive)

    return { totalGB, usedGB, freeGB, source: 'vm_stat' }
  } catch (e) {
    return { totalGB: 0, usedGB: 0, freeGB: 0, source: 'error', error: String(e) }
  }
}

// ── Gateway Status ───────────────────────────────────────────────────────────

function getGatewayStatus(): 'running' | 'stopped' | 'unknown' {
  try {
    execSync('pgrep -f "openclaw.*gateway"', { encoding: 'utf-8', timeout: 3000 })
    return 'running'
  } catch {
    // pgrep returns non-zero if no process found
    try {
      // Fallback: try curl to gateway port
      execSync(
        `curl -s --max-time 2 -o /dev/null -w "%{http_code}" http://localhost:${config.gatewayPort}/`,
        { encoding: 'utf-8', timeout: 5000 }
      )
      return 'running'
    } catch {
      return 'stopped'
    }
  }
}

// ── Sessions Cache (30s TTL) ─────────────────────────────────────────────────
let _sessionsCache: Record<string, SessionEntry> | null = null
let _sessionsCacheTime = 0
const SESSIONS_CACHE_TTL_MS = 30000

// ── Active Sessions ──────────────────────────────────────────────────────────

interface SessionEntry {
  sessionId?: string
  lastActiveAt?: number
  createdAt?: number
  label?: string
}

async function getActiveSessions(): Promise<{
  active_sessions: number
  sessions: { key: string; age_min: number; label: string }[]
  orphan_count: number
}> {
  const sessionsPath = path.join(config.openclawStateDir, 'agents', 'main', 'sessions', 'sessions.json')
  const nowMs = Date.now()
  const active: { key: string; age_min: number; label: string }[] = []
  let orphanCount = 0

  try {
    // Use cache if fresh
    if (_sessionsCache && (nowMs - _sessionsCacheTime) < SESSIONS_CACHE_TTL_MS) {
      // Use cached data
    } else {
      const raw = await readFile(sessionsPath, 'utf-8')
      _sessionsCache = JSON.parse(raw)
      _sessionsCacheTime = nowMs
    }
    const sessData = _sessionsCache!

    for (const [key, sess] of Object.entries(sessData)) {
      const lastActive = sess.lastActiveAt || sess.createdAt || 0
      const ageMin = lastActive ? Math.floor((nowMs - lastActive) / 60000) : 9999

      // Consider orphan if >2 hours old and not a known persistent session
      if (ageMin > 120 && !key.includes('cron:') && !key.includes('heartbeat')) {
        orphanCount++
      }

      // Active in last hour
      if (ageMin < 60) {
        active.push({
          key,
          age_min: ageMin,
          label: sess.label || key.split(':').pop() || key,
        })
      }
    }

    return {
      active_sessions: active.length,
      sessions: active.slice(0, 10), // Cap at 10
      orphan_count: orphanCount,
    }
  } catch {
    return { active_sessions: 0, sessions: [], orphan_count: 0 }
  }
}

// ── Cron Health ──────────────────────────────────────────────────────────────

interface CronHealthResult {
  total: number
  healthy: number
  failing: number
  failing_jobs: {
    id: string
    name: string
    consecutive_errors: number
    last_error: string
  }[]
  next_run: { name: string; in_minutes: number } | null
}

async function getCronHealth(): Promise<CronHealthResult> {
  const jobs = await loadCronJobs()
  const nowMs = Date.now()

  const total = jobs.length
  const failing: CronHealthResult['failing_jobs'] = []
  let healthy = 0
  let nextRun: CronHealthResult['next_run'] = null
  let nextRunMin = Infinity

  for (const job of jobs) {
    if (job.enabled === false) continue

    const state = job.state || {}
    const errs = state.consecutiveErrors || 0

    if (errs >= 1) {
      failing.push({
        id: (job.id || '?').slice(0, 8),
        name: job.name || 'unknown',
        consecutive_errors: errs,
        last_error: (state.lastError || 'unknown').slice(0, 50),
      })
    } else {
      healthy++
    }

    // Find next scheduled run
    const nextMs = state.nextRunAtMs
    if (nextMs) {
      const minsUntil = (nextMs - nowMs) / 60000
      if (minsUntil > 0 && minsUntil < nextRunMin) {
        nextRunMin = minsUntil
        nextRun = { name: job.name || 'unknown', in_minutes: Math.floor(minsUntil) }
      }
    }
  }

  return {
    total,
    healthy,
    failing: failing.length,
    failing_jobs: failing.slice(0, 5), // Cap at 5
    next_run: nextRun,
  }
}

// ── Memory Health ────────────────────────────────────────────────────────────

interface MemoryHealthResult {
  today_file: string
  today_entries: number
  last_write: string
  last_write_age_min: number
  stale: boolean
  last_checkpoint: string
}

async function getMemoryHealth(): Promise<MemoryHealthResult> {
  const now = new Date()
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const memFile = path.join(getWorkspacePath(), 'memory', `${todayStr}.md`)
  let lastWriteAgeMin = 9999
  let entries = 0
  let lastCheckpoint = '—'
  let lastWrite = 'unknown'

  try {
    const fileStat = await stat(memFile)
    const mtime = fileStat.mtimeMs
    lastWriteAgeMin = Math.floor((now.getTime() - mtime) / 60000)
    lastWrite = new Date(mtime).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZone: 'America/New_York',
    }) + ' EST'

    const content = await readFile(memFile, 'utf-8')
    const headers = content.split('\n').filter(l => l.startsWith('## '))
    entries = headers.length
    if (headers.length > 0) {
      lastCheckpoint = headers[headers.length - 1].replace('## ', '')
    }
  } catch {
    lastWrite = 'file not found'
    lastWriteAgeMin = 9999
  }

  const stale = lastWriteAgeMin > 60

  return {
    today_file: `${todayStr}.md`,
    today_entries: entries,
    last_write: lastWrite,
    last_write_age_min: lastWriteAgeMin,
    stale,
    last_checkpoint: lastCheckpoint,
  }
}

// ── Build Alerts ─────────────────────────────────────────────────────────────

function buildAlerts(
  breakerFlag: { tripped: boolean; reason?: string },
  ram: RamStats,
  gateway: 'running' | 'stopped' | 'unknown',
  orphanCount: number,
  cronHealth: CronHealthResult,
  memoryStale: boolean,
  memoryLastWriteAgeMin: number,
  tasks: { pending: unknown[]; carry_forward: unknown[] }
): { critical: string[]; warning: string[]; info: string[] } {
  const alerts = { critical: [] as string[], warning: [] as string[], info: [] as string[] }

  // Critical alerts
  if (breakerFlag.tripped) {
    alerts.critical.push(
      `🔴 Circuit breaker tripped — ${breakerFlag.reason || 'unknown reason'}. Call POST /api/budget/reset with confirm=true to clear.`
    )
  }

  if (ram.freeGB < 1) {
    alerts.critical.push(`RAM at ${Math.floor(ram.freeGB * 1024)}MB — below 1GB threshold`)
  }

  if (gateway !== 'running') {
    alerts.critical.push('Gateway not running')
  }

  // Warning alerts
  if (ram.freeGB >= 1 && ram.freeGB < 2) {
    alerts.warning.push(`RAM at ${ram.freeGB.toFixed(1)}GB — below 2GB`)
  }

  if (orphanCount >= 3) {
    alerts.warning.push(`${orphanCount} orphan sessions detected`)
  }

  for (const job of cronHealth.failing_jobs) {
    if (job.consecutive_errors >= 2) {
      alerts.warning.push(`${job.name}: ${job.consecutive_errors} consecutive errors`)
    }
  }

  // Info alerts
  if (memoryStale) {
    alerts.info.push(`Memory file stale — last write ${memoryLastWriteAgeMin}min ago`)
  }

  // High-priority tasks
  const highPri = (tasks.pending as { priority?: string }[]).filter(t => t.priority === 'high')
  if (highPri.length > 0) {
    alerts.info.push(`${highPri.length} high-priority tasks pending`)
  }

  // Positive info if nothing critical/warning
  if (alerts.critical.length === 0 && alerts.warning.length === 0) {
    if (cronHealth.healthy > 0) {
      alerts.info.push(`${cronHealth.healthy} crons healthy`)
    }
  }

  return alerts
}

// ── Main Handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const startMs = Date.now()
  const now = new Date()

  const result: AwarenessResult = {
    timestamp: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    version: 1,
    alerts: { critical: [], warning: [], info: [] },
    system: {},
    agents: {},
    crons: {},
    memory: {},
    tasks: { pending: [], carry_forward: [] },
    context_hints: [],
    meta: { sources: [] },
  }

  // ── CIRCUIT BREAKER CHECK ──
  let breakerFlag: { tripped: boolean; reason?: string } = { tripped: false }
  try {
    breakerFlag = await readBreakerFlag()
    if (breakerFlag.tripped) {
      result.meta.sources.push('breaker-flag')
    }
  } catch {
    // Don't let breaker check failure block awareness
  }

  // ── SYSTEM HEALTH ──
  let ram: RamStats = { totalGB: 0, usedGB: 0, freeGB: 0, source: 'error' }
  let gateway: 'running' | 'stopped' | 'unknown' = 'unknown'
  try {
    ram = getRam()
    result.meta.sources.push('ram')

    const ramGb = ram.freeGB
    const ramMb = Math.floor(ramGb * 1024)

    let status: string
    if (ramGb < 1) {
      status = 'critical'
    } else if (ramGb < 2) {
      status = 'warning'
    } else if (ramGb < 4) {
      status = 'warning'
    } else {
      status = 'healthy'
    }

    gateway = getGatewayStatus()

    result.system = {
      ram_mb: ramMb,
      ram_gb: Math.round(ramGb * 100) / 100,
      ram_status: status,
      total_gb: ram.totalGB,
      used_gb: ram.usedGB,
      gateway,
    }
  } catch (e) {
    result.system.error = String(e)
  }

  // ── ACTIVE SESSIONS ──
  let orphanCount = 0
  try {
    const sessions = await getActiveSessions()
    result.meta.sources.push('sessions')
    result.agents = sessions
    orphanCount = sessions.orphan_count
  } catch (e) {
    result.agents.error = String(e)
  }

  // ── CRON HEALTH ──
  let cronHealth: CronHealthResult = { total: 0, healthy: 0, failing: 0, failing_jobs: [], next_run: null }
  try {
    cronHealth = await getCronHealth()
    result.meta.sources.push('crons')
    result.crons = cronHealth
  } catch (e) {
    result.crons.error = String(e)
  }

  // ── MEMORY HEALTH ──
  let memoryStale = false
  let memoryLastWriteAgeMin = 9999
  try {
    const memory = await getMemoryHealth()
    result.meta.sources.push('memory')
    result.memory = memory
    memoryStale = memory.stale
    memoryLastWriteAgeMin = memory.last_write_age_min
  } catch (e) {
    result.memory.error = String(e)
  }

  // ── TASKS ──
  try {
    const tasks = await loadTasks()
    result.meta.sources.push('tasks.json')
    result.tasks = tasks
  } catch {
    // Keep defaults
  }

  // ── CONTEXT HINTS ──
  try {
    const hints = await loadContextHints()
    if (hints.length > 0) {
      result.meta.sources.push('context-hints.txt')
      result.context_hints = hints
    }
  } catch {
    // Keep empty
  }

  // ── BUILD ALERTS ──
  result.alerts = buildAlerts(
    breakerFlag,
    ram,
    gateway,
    orphanCount,
    cronHealth,
    memoryStale,
    memoryLastWriteAgeMin,
    result.tasks
  )

  // ── META ──
  result.meta.generated_in_ms = Date.now() - startMs

  return NextResponse.json(result)
}
