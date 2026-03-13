import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { loadCronJobs, readBusEvents, getWorkspacePath, type CronJob, type BusEvent } from '@/lib/briefing-helpers'

// ── Constants ───────────────────────────────────────────────────────────────
const SPECIALIST_AGENTS = ['watson', 'librarian', 'treasurer', 'dispatch', 'herald', 'clue-master', 'puzzle-master']

// ── Cron Jobs Cache (5s TTL) ─────────────────────────────────────────────────
let _cronJobsCache: CronJob[] | null = null
let _cronJobsCacheTime = 0
const CRON_CACHE_TTL_MS = 5000

async function getCachedCronJobs(): Promise<CronJob[]> {
  const now = Date.now()
  if (_cronJobsCache && (now - _cronJobsCacheTime) < CRON_CACHE_TTL_MS) {
    return _cronJobsCache
  }
  _cronJobsCache = await loadCronJobs()
  _cronJobsCacheTime = now
  return _cronJobsCache
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

// ── Data Source Readers ─────────────────────────────────────────────────────

interface PendingApproval {
  type: string
  message_id?: string
  id?: string
  text?: string
  summary?: string
  created_at?: string
  channel?: string
  agent?: string
}

async function getPendingApprovals(): Promise<PendingApproval[]> {
  const pending: PendingApproval[] = []
  const seenIds = new Set<string>()

  // NEW canonical location: ~/.openclaw/workspace/data/x-pending-drafts.json
  const draftsFileNew = path.join(config.openclawStateDir, 'workspace', 'data', 'x-pending-drafts.json')
  try {
    const raw = await readFile(draftsFileNew, 'utf-8')
    const data = JSON.parse(raw)
    const drafts = data.drafts || []

    if (Array.isArray(drafts)) {
      for (const draft of drafts) {
        if (draft.status === 'pending') {
          const msgId = draft.messageId || draft.message_id || ''
          const createdAt = draft.createdAt || draft.created_at
          seenIds.add(msgId)
          pending.push({
            type: 'barker_draft',
            message_id: msgId,
            text: (draft.text || '').slice(0, 120),
            created_at: createdAt,
            channel: draft.channelId || draft.channel,
          })
        }
      }
    } else if (typeof drafts === 'object') {
      for (const [msgId, draft] of Object.entries(drafts) as [string, any][]) {
        if (draft.status === 'pending') {
          const createdAt = draft.created_at || draft.createdAt
          seenIds.add(msgId)
          pending.push({
            type: 'barker_draft',
            message_id: msgId,
            text: (draft.text || '').slice(0, 120),
            created_at: createdAt,
            channel: draft.channel,
          })
        }
      }
    }
  } catch {
    // File doesn't exist or parse error — continue
  }

  // LEGACY location: workspace/scripts/x-pending-drafts.json
  const draftsFileLegacy = path.join(getWorkspacePath(), 'scripts', 'x-pending-drafts.json')
  try {
    const raw = await readFile(draftsFileLegacy, 'utf-8')
    const data = JSON.parse(raw)
    const drafts = data.drafts || {}

    if (typeof drafts === 'object' && !Array.isArray(drafts)) {
      for (const [msgId, draft] of Object.entries(drafts) as [string, any][]) {
        if (seenIds.has(msgId)) continue
        if (draft.status !== 'pending') continue
        const createdAt = draft.created_at || draft.createdAt
        pending.push({
          type: 'barker_draft',
          message_id: msgId,
          text: (draft.text || '').slice(0, 120),
          created_at: createdAt,
          channel: draft.channel,
        })
      }
    }
  } catch {
    // File doesn't exist or parse error — continue
  }

  // approval-queue.json (same directory as legacy Python routes)
  const approvalsFile = path.join(getWorkspacePath(), 'apps', 'watson-os', 'routes', 'approval-queue.json')
  try {
    const raw = await readFile(approvalsFile, 'utf-8')
    const data = JSON.parse(raw)
    const items = Array.isArray(data) ? data : data.approvals || []

    for (const item of items) {
      if (item.status === 'pending' || item.status === null || item.status === '' || item.status === undefined) {
        pending.push({
          type: 'approval',
          id: item.id,
          summary: (item.summary || '').slice(0, 120),
          created_at: item.created_at,
          agent: item.agent,
        })
      }
    }
  } catch {
    // File doesn't exist or parse error — continue
  }

  return pending
}

interface MailboxItem {
  filename: string
  preview: string
  size_bytes: number
  mtime: string
}

async function getUnreadMailbox(): Promise<MailboxItem[]> {
  const mailboxDir = path.join(config.openclawStateDir, 'mailbox', 'to-watson')
  const items: MailboxItem[] = []

  try {
    const files = await readdir(mailboxDir)
    for (const filename of files.sort()) {
      if (!['.md', '.txt', '.json'].some(ext => filename.endsWith(ext))) continue
      try {
        const filePath = path.join(mailboxDir, filename)
        const content = await readFile(filePath, 'utf-8')
        const fileStat = await stat(filePath)
        items.push({
          filename,
          preview: content.slice(0, 300),
          size_bytes: fileStat.size,
          mtime: new Date(fileStat.mtimeMs).toISOString(),
        })
      } catch {
        // Skip files that can't be read
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return items
}

interface CronError {
  name: string
  id: string
  consecutiveErrors: number
  lastError: string
  lastStatus: string
  enabled: boolean
}

async function getCronErrors(): Promise<CronError[]> {
  const jobs = await getCachedCronJobs()
  const errors: CronError[] = []

  for (const job of jobs) {
    const state = job.state || {}
    const errs = state.consecutiveErrors || 0
    const lastErr = state.lastError || ''

    if (errs > 0) {
      errors.push({
        name: job.name || '',
        id: job.id || '',
        consecutiveErrors: errs,
        lastError: lastErr,
        lastStatus: state.lastStatus || '',
        enabled: job.enabled !== false,
      })
    }
  }

  return errors
}

interface SubAgentCompletion {
  agent: string
  commit?: string
  summary?: string
  ts: string
}

async function getSubAgentCompletions(sinceHours: number = 12, events: BusEvent[]): Promise<SubAgentCompletion[]> {
  const cutoff = new Date(Date.now() - sinceHours * 60 * 60 * 1000)
  const completions: SubAgentCompletion[] = []
  const seen = new Set<string>()

  for (const e of events) {
    if (e.type !== 'agent_done') continue
    try {
      const ts = new Date(e.ts || '')
      if (ts < cutoff) continue
    } catch {
      continue
    }

    const data = e.data || {}
    const agent = (data.agent as string) || e.agent || ''
    const commit = data.commit as string | undefined
    const dedupKey = `${agent}:${commit}`

    if (seen.has(dedupKey)) continue
    seen.add(dedupKey)

    completions.push({
      agent,
      commit,
      summary: e.message,
      ts: e.ts || '',
    })
  }

  return completions
}

interface SpecialistCronStatus {
  has_enabled_crons: boolean
  is_overdue: boolean
  next_run_ms: number | null
  overdue_by_min: number
}

async function getSpecialistCronStatus(agentId: string): Promise<SpecialistCronStatus> {
  const nowMs = Date.now()
  const jobs = await getCachedCronJobs()
  const agentJobs = jobs.filter(j => j.agentId === agentId && j.enabled === true)

  if (agentJobs.length === 0) {
    return { has_enabled_crons: false, is_overdue: false, next_run_ms: null, overdue_by_min: 0 }
  }

  const nextRuns: number[] = []
  const overdueJobs: number[] = []

  for (const j of agentJobs) {
    const state = j.state || {}
    const nextMs = state.nextRunAtMs
    if (nextMs !== undefined && nextMs !== null) {
      nextRuns.push(nextMs)
      // Overdue = next run was scheduled >10 min ago
      if (nowMs - nextMs > 10 * 60 * 1000) {
        overdueJobs.push(nextMs)
      }
    }
  }

  if (nextRuns.length === 0) {
    return { has_enabled_crons: true, is_overdue: true, next_run_ms: null, overdue_by_min: 0 }
  }

  const earliestNext = Math.min(...nextRuns)
  const isOverdue = overdueJobs.length > 0
  const overdueByMin = overdueJobs.length > 0 ? Math.round((nowMs - Math.min(...overdueJobs)) / 60000) : 0

  return {
    has_enabled_crons: true,
    is_overdue: isOverdue,
    next_run_ms: earliestNext,
    overdue_by_min: overdueByMin,
  }
}

async function getSpecialistLastCronRun(agentId: string): Promise<Date | null> {
  const jobs = await getCachedCronJobs()
  const agentJobs = jobs.filter(j => j.agentId === agentId && j.enabled === true)

  let latestRun: Date | null = null

  for (const j of agentJobs) {
    const state = j.state || {}
    // Only count successful runs
    // Python logic: skip if BOTH lastRunStatus is not (ok or None) AND lastStatus is not ok
    // If either field is ok, or lastRunStatus is undefined/null, include the job
    const runStatus = state.lastRunStatus ?? null
    const lstStatus = state.lastStatus ?? null
    if (runStatus !== 'ok' && runStatus !== null && lstStatus !== 'ok') {
      continue
    }
    const lastRunMs = state.lastRunAtMs
    if (lastRunMs) {
      try {
        const ts = new Date(lastRunMs)
        if (latestRun === null || ts > latestRun) {
          latestRun = ts
        }
      } catch {
        // Skip
      }
    }
  }

  return latestRun
}

interface SilentSpecialist {
  agent: string
  last_seen: string | null
  hours_silent: number | string
  has_enabled_crons: boolean
  cron_overdue: boolean
  overdue_by_min: number
  next_cron_run_ms: number | null
}

async function getSilentSpecialists(thresholdHours: number = 6, events: BusEvent[]): Promise<SilentSpecialist[]> {
  const cutoff = new Date(Date.now() - thresholdHours * 60 * 60 * 1000)

  const lastSeen: Record<string, Date> = {}
  for (const e of events) {
    const agent = e.agent || ''
    if (!agent) continue
    try {
      const ts = new Date(e.ts || '')
      if (!lastSeen[agent] || ts > lastSeen[agent]) {
        lastSeen[agent] = ts
      }
    } catch {
      // Skip
    }
  }

  const silent: SilentSpecialist[] = []

  for (const agent of SPECIALIST_AGENTS) {
    if (agent === 'watson') continue // watson is always "active"

    let seen = lastSeen[agent] || null

    // Fallback: check cron lastRunAtMs for recent successful runs
    if (!seen || seen < cutoff) {
      const lastCronRun = await getSpecialistLastCronRun(agent)
      if (lastCronRun && lastCronRun >= cutoff) {
        seen = lastCronRun
      }
    }

    if (!seen || seen < cutoff) {
      const cronStatus = await getSpecialistCronStatus(agent)
      const hoursSilent = seen ? Math.round((Date.now() - seen.getTime()) / 3600000 * 10) / 10 : null

      silent.push({
        agent,
        last_seen: seen ? seen.toISOString() : null,
        hours_silent: hoursSilent !== null ? hoursSilent : 'never',
        has_enabled_crons: cronStatus.has_enabled_crons,
        cron_overdue: cronStatus.is_overdue,
        overdue_by_min: cronStatus.overdue_by_min,
        next_cron_run_ms: cronStatus.next_run_ms,
      })
    }
  }

  return silent
}

interface SpecialistHealth {
  events_per_hour: number
  total_events: number
  cron_success_rate: number | null
  cron_consecutive_errors: number
  last_success_ts: string | null
  status: 'healthy' | 'degraded' | 'silent' | 'low'
}

async function getSpecialistHealthScores(windowHours: number = 24, events: BusEvent[]): Promise<Record<string, SpecialistHealth>> {
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000)

  const agentEvents: Record<string, Date[]> = {}
  for (const e of events) {
    const agent = e.agent || ''
    if (!agent || agent === 'watson') continue
    try {
      const ts = new Date(e.ts || '')
      if (ts < cutoff) continue
      if (!agentEvents[agent]) agentEvents[agent] = []
      agentEvents[agent].push(ts)
    } catch {
      // Skip
    }
  }

  const jobs = await getCachedCronJobs()
  const cronByAgent: Record<string, CronJob[]> = {}
  for (const j of jobs) {
    const aid = j.agentId || ''
    if (aid) {
      if (!cronByAgent[aid]) cronByAgent[aid] = []
      cronByAgent[aid].push(j)
    }
  }

  const results: Record<string, SpecialistHealth> = {}

  for (const agent of SPECIALIST_AGENTS) {
    if (agent === 'watson') continue

    const evts = agentEvents[agent] || []
    const totalEvents = evts.length
    const eventsPerHour = Math.round((totalEvents / windowHours) * 100) / 100
    let lastSuccessTs: string | null = evts.length > 0 ? evts.reduce((a, b) => a > b ? a : b).toISOString() : null

    // Cron health
    const agentJobs = cronByAgent[agent] || []
    let maxConsecErrors = 0
    let cronOkCount = 0
    let cronTotal = 0

    for (const j of agentJobs) {
      if (j.enabled !== true) continue
      const state = j.state || {}
      const consec = state.consecutiveErrors || 0
      maxConsecErrors = Math.max(maxConsecErrors, consec)

      const lastStatus = state.lastStatus || state.lastRunStatus || ''
      if (lastStatus) {
        cronTotal++
        if (lastStatus === 'ok') {
          cronOkCount++
        }
      }

      // If cron ran ok recently, update last_success_ts
      if (lastStatus === 'ok') {
        const lastMs = state.lastRunAtMs
        if (lastMs) {
          try {
            const cronTs = new Date(lastMs)
            if (cronTs >= cutoff) {
              if (lastSuccessTs === null || cronTs.toISOString() > lastSuccessTs) {
                lastSuccessTs = cronTs.toISOString()
              }
            }
          } catch {
            // Skip
          }
        }
      }
    }

    const cronSuccessRate = cronTotal > 0 ? Math.round((cronOkCount / cronTotal) * 100) / 100 : null

    // Determine status
    let status: SpecialistHealth['status']
    if (totalEvents === 0 && lastSuccessTs === null) {
      status = 'silent'
    } else if (maxConsecErrors >= 3 || (cronSuccessRate !== null && cronSuccessRate < 0.5)) {
      status = 'degraded'
    } else if (maxConsecErrors >= 1 || eventsPerHour < 0.1) {
      status = 'low'
    } else {
      status = 'healthy'
    }

    results[agent] = {
      events_per_hour: eventsPerHour,
      total_events: totalEvents,
      cron_success_rate: cronSuccessRate,
      cron_consecutive_errors: maxConsecErrors,
      last_success_ts: lastSuccessTs,
      status,
    }
  }

  return results
}

async function getOpenCarryForwards(): Promise<string[]> {
  const forwards: string[] = []
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const memDir = path.join(getWorkspacePath(), 'memory')

  let memFile = path.join(memDir, `${today}.md`)
  try {
    await stat(memFile)
  } catch {
    // Try yesterday
    const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    memFile = path.join(memDir, `${yesterday}.md`)
    try {
      await stat(memFile)
    } catch {
      return forwards
    }
  }

  try {
    const text = await readFile(memFile, 'utf-8')
    const markers = ['**Carry-forward:**', 'carry-forward:', 'TODO:', '[ ]']

    for (const line of text.split('\n')) {
      if (markers.some(m => line.includes(m))) {
        const clean = line.trim().replace(/^[-*]\s*/, '').trim()
        if (clean.length > 10) {
          forwards.push(clean.slice(0, 150))
        }
      }
    }
  } catch {
    // File read error
  }

  return forwards.slice(0, 8)
}

interface BudgetSignal {
  status: string
  payg_today: number | null
  pct_used: number | null
  daily_limit?: number
  generated_at?: string
  error?: string
}

async function getBudgetSignal(): Promise<BudgetSignal> {
  const budgetFile = path.join(config.openclawStateDir, 'data', 'treasurer', 'budget-summary.json')

  try {
    const raw = await readFile(budgetFile, 'utf-8')
    const data = JSON.parse(raw)
    const cb = data.circuitBreaker || {}
    const payg = cb.paygToday || 0
    const pct = cb.pctUsed || 0
    const cbStatus = cb.status || 'unknown'

    let signal: string
    if (cbStatus === 'tripped' || pct >= 100) {
      signal = 'critical'
    } else if (pct >= 75) {
      signal = 'warn'
    } else {
      signal = 'ok'
    }

    return {
      status: signal,
      payg_today: Math.round(payg * 10000) / 10000,
      pct_used: Math.round(pct * 10) / 10,
      daily_limit: cb.dailyLimit || 20,
      generated_at: data.generatedAt,
    }
  } catch {
    return { status: 'unknown', payg_today: null, pct_used: null, generated_at: undefined }
  }
}

// ── Main Handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  let hours = 12
  try {
    hours = parseInt(searchParams.get('hours') || '12', 10)
  } catch {
    // Use default
  }

  // Read bus events ONCE (max limit for all consumers)
  const allBusEvents = await readBusEvents(5000)

  // Gather all data sources (each catches its own errors with defaults)
  const [
    approvals,
    mailbox,
    cronErrors,
    completions,
    silent,
    carryFwds,
    budget,
    specialistHealth,
  ] = await Promise.all([
    getPendingApprovals().catch(() => [] as PendingApproval[]),
    getUnreadMailbox().catch(() => [] as MailboxItem[]),
    getCronErrors().catch(() => [] as CronError[]),
    getSubAgentCompletions(hours, allBusEvents).catch(() => [] as SubAgentCompletion[]),
    getSilentSpecialists(24, allBusEvents).catch(() => [] as SilentSpecialist[]),
    getOpenCarryForwards().catch(() => [] as string[]),
    getBudgetSignal().catch(() => ({ status: 'unknown', payg_today: null, pct_used: null } as BudgetSignal)),
    getSpecialistHealthScores(24, allBusEvents).catch(() => ({} as Record<string, SpecialistHealth>)),
  ])

  // Attention score calculation (time-aware)
  const now = new Date()
  const etHour = parseInt(now.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' }), 10)
  // Quiet hours: 2-7 AM ET (DST-aware)
  const isQuietHours = etHour >= 2 && etHour < 7

  // Approvals: only count as urgent if owner is awake AND approval is fresh (<4h old)
  let urgentApprovals = 0
  for (const a of approvals) {
    const created = a.created_at
    if (isQuietHours) {
      // Don't count approvals as urgent during quiet hours
    } else {
      if (created) {
        try {
          const ageH = (Date.now() - new Date(created).getTime()) / 3600000
          if (ageH < 4) {
            urgentApprovals++
          }
        } catch {
          urgentApprovals++
        }
      } else {
        urgentApprovals++
      }
    }
  }

  // Cron errors: only count enabled jobs with ≥2 consecutive errors
  const urgentCron = cronErrors.filter(e => e.enabled && (e.consecutiveErrors || 0) >= 2).length

  // Mailbox: always urgent
  const urgentMailbox = mailbox.length

  // Silent specialists: only count those who are TRULY overdue
  const overdueSilent = silent.filter(s => s.cron_overdue)
  let urgentSilent = overdueSilent.length
  if (isQuietHours) {
    urgentSilent = Math.max(0, urgentSilent - 1)
  }

  const attentionItems = urgentApprovals + urgentMailbox + urgentCron + urgentSilent
  let attentionLevel: 'clear' | 'low' | 'medium' | 'high'
  if (attentionItems === 0) {
    attentionLevel = 'clear'
  } else if (attentionItems <= 2) {
    attentionLevel = 'low'
  } else if (attentionItems <= 5) {
    attentionLevel = 'medium'
  } else {
    attentionLevel = 'high'
  }

  return NextResponse.json({
    generated_at: nowIso(),
    window_hours: hours,
    attention_level: attentionLevel,
    attention_items: attentionItems,
    pending_approvals: approvals,
    mailbox,
    cron_errors: cronErrors,
    sub_agent_completions: completions,
    silent_specialists: silent,
    specialist_health: specialistHealth,
    carry_forwards: carryFwds,
    budget,
    summary: {
      approvals: approvals.length,
      approvals_urgent: urgentApprovals,
      mailbox_unread: mailbox.length,
      cron_errors: cronErrors.filter(e => e.enabled).length,
      cron_errors_urgent: urgentCron,
      completions: completions.length,
      silent_specialists: silent.length,
      budget_status: budget.status,
      budget_payg_today: budget.payg_today,
      quiet_hours: isQuietHours,
    },
  })
}
