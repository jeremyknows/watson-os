'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface BusEvent {
  id: string
  ts: string
  agent: string
  type: string
  message: string
  data: unknown
  topic: string | null
  source: 'bus' | 'bridge'
}

type FilterType = 'all' | 'bus' | 'bridge' | 'memory' | 'tasks' | 'errors'

function formatRelativeTime(timestamp: string): string {
  const now = Date.now()
  const time = Date.parse(timestamp)
  const diffMs = now - time
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSeconds < 60) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return new Date(time).toLocaleDateString()
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '...'
}

export function WatsonIntelligenceFeedPanel() {
  const [events, setEvents] = useState<BusEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterType>('all')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [autoScroll, setAutoScroll] = useState(true)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const prevEventsLengthRef = useRef(0)

  const fetchEvents = useCallback(async () => {
    try {
      setError(null)
      const response = await fetch('/api/bus?source=all&limit=100')
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`)
      }
      const data = await response.json()
      setEvents(data)
      setLastFetch(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch events')
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial fetch
  useEffect(() => {
    fetchEvents()
  }, [fetchEvents])

  // Poll every 10 seconds
  useEffect(() => {
    const interval = setInterval(fetchEvents, 10000)
    return () => clearInterval(interval)
  }, [fetchEvents])

  // Auto-scroll to top on new events
  useEffect(() => {
    if (autoScroll && events.length > prevEventsLengthRef.current && containerRef.current) {
      containerRef.current.scrollTop = 0
    }
    prevEventsLengthRef.current = events.length
  }, [events.length, autoScroll])

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // Filter events based on selected filter
  const filteredEvents = events.filter(event => {
    switch (filter) {
      case 'bus':
        return event.source === 'bus'
      case 'bridge':
        return event.source === 'bridge'
      case 'memory':
        return event.type.toLowerCase().includes('memory')
      case 'tasks':
        return event.type.toLowerCase().includes('task') || event.type.toLowerCase().includes('sprint')
      case 'errors':
        return event.type.toLowerCase().includes('error') || event.type.toLowerCase().includes('fail')
      default:
        return true
    }
  })

  const getSourceDotColor = (source: 'bus' | 'bridge') => {
    return source === 'bus' ? 'bg-blue-500' : 'bg-purple-500'
  }

  const getAgentInitial = (agent: string) => {
    if (!agent || agent === 'unknown') return '?'
    return agent.charAt(0).toUpperCase()
  }

  const getAgentColor = (agent: string) => {
    // Simple hash-based color assignment
    const colors = [
      'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      'bg-blue-500/20 text-blue-400 border-blue-500/30',
      'bg-purple-500/20 text-purple-400 border-purple-500/30',
      'bg-orange-500/20 text-orange-400 border-orange-500/30',
      'bg-pink-500/20 text-pink-400 border-pink-500/30',
      'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    ]
    let hash = 0
    for (let i = 0; i < agent.length; i++) {
      hash = agent.charCodeAt(i) + ((hash << 5) - hash)
    }
    return colors[Math.abs(hash) % colors.length]
  }

  const filters: { id: FilterType; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'bus', label: 'Bus' },
    { id: 'bridge', label: 'Bridge' },
    { id: 'memory', label: 'Memory' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'errors', label: 'Errors' },
  ]

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="border-b border-border pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Watson Intelligence Feed</h1>
            <p className="text-muted-foreground mt-2">
              Real-time merged timeline of bus and bridge events
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setAutoScroll(!autoScroll)}
              className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                autoScroll
                  ? 'bg-green-500/20 text-green-400 border-green-500/30'
                  : 'bg-secondary text-muted-foreground border-border'
              }`}
            >
              {autoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
            </button>
            <button
              onClick={fetchEvents}
              disabled={loading}
              className="px-4 py-2 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-md font-medium hover:bg-blue-500/30 transition-colors disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2">
        {filters.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
              filter === f.id
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-secondary text-muted-foreground border-border hover:text-foreground hover:bg-secondary/80'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center">
              <span className="text-red-400 font-bold">!</span>
            </div>
            <div>
              <p className="text-red-400 font-medium">Failed to load events</p>
              <p className="text-red-400/70 text-sm">{error}</p>
            </div>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-red-400/60 hover:text-red-400"
          >
            &times;
          </button>
        </div>
      )}

      {/* Events list */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div
          ref={containerRef}
          className="max-h-[600px] overflow-y-auto divide-y divide-border"
        >
          {loading && events.length === 0 ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
              <span className="ml-3 text-muted-foreground">Loading events...</span>
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                className="w-8 h-8 mb-2 opacity-50"
              >
                <polyline points="1,8 4,8 6,3 8,13 10,6 12,8 15,8" />
              </svg>
              <p className="text-sm">No events yet - Watson is quiet.</p>
            </div>
          ) : (
            filteredEvents.map(event => {
              const isExpanded = expandedIds.has(event.id)
              const displayMessage = isExpanded ? event.message : truncateText(event.message, 120)
              const needsTruncation = event.message.length > 120

              return (
                <div
                  key={event.id}
                  className="p-4 hover:bg-secondary/30 transition-colors cursor-pointer"
                  onClick={() => needsTruncation && toggleExpanded(event.id)}
                >
                  <div className="flex items-start gap-3">
                    {/* Source dot */}
                    <div className="flex-shrink-0 pt-1.5">
                      <div
                        className={`w-2.5 h-2.5 rounded-full ${getSourceDotColor(event.source)}`}
                        title={event.source === 'bus' ? 'Event Bus' : 'Bridge'}
                      />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Timestamp */}
                        <span
                          className="text-xs text-muted-foreground"
                          title={event.ts}
                        >
                          {formatRelativeTime(event.ts)}
                        </span>

                        {/* Agent badge */}
                        <span
                          className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold border ${getAgentColor(event.agent)}`}
                          title={event.agent}
                        >
                          {getAgentInitial(event.agent)}
                        </span>
                        <span className="text-xs text-muted-foreground">{event.agent}</span>

                        {/* Event type chip */}
                        <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-muted-foreground/10 text-muted-foreground">
                          {event.type}
                        </span>
                      </div>

                      {/* Message */}
                      <p className="mt-1 text-sm text-foreground break-words">
                        {displayMessage}
                        {needsTruncation && !isExpanded && (
                          <span className="text-primary/70 ml-1 text-xs">(click to expand)</span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border bg-secondary/30 px-4 py-2 text-xs text-muted-foreground flex justify-between items-center">
          <span>
            Showing {filteredEvents.length} of {events.length} events
            {filter !== 'all' && ` (filtered by ${filter})`}
          </span>
          {lastFetch && (
            <span>Last updated: {lastFetch.toLocaleTimeString()}</span>
          )}
        </div>
      </div>
    </div>
  )
}
