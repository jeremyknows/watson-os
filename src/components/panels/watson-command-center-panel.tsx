'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface BridgeMessage {
  id: string
  ts: string
  direction: string | null
  from: string
  type: string
  content: string
  message?: string
  ref?: string
  data: {
    direction?: string | null
    schema_version?: string | null
    ref?: string
  }
}

interface CommandEntry {
  id: string
  ts: string
  command: string
  response?: string
  responseTs?: string
  status: 'pending' | 'sent' | 'responded'
}

const QUICK_COMMANDS = [
  { label: 'Check briefing', icon: '🧠', command: 'Check your briefing and summarize any pending items' },
  { label: 'Status', icon: '📋', command: 'Give me a quick status update on your current work' },
  { label: 'Run triage', icon: '🔬', command: 'Run a triage on current priorities and flag anything urgent' },
]

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function getTypeBadgeColor(type: string): string {
  switch (type.toLowerCase()) {
    case 'task':
      return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
    case 'ack':
      return 'bg-green-500/20 text-green-400 border-green-500/30'
    case 'result':
      return 'bg-purple-500/20 text-purple-400 border-purple-500/30'
    case 'query':
      return 'bg-orange-500/20 text-orange-400 border-orange-500/30'
    default:
      return 'bg-muted-foreground/20 text-muted-foreground border-muted-foreground/30'
  }
}

export function WatsonCommandCenterPanel() {
  const [commandInput, setCommandInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recentMessages, setRecentMessages] = useState<BridgeMessage[]>([])
  const [ccOnline, setCcOnline] = useState(false)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Fetch recent bridge messages
  const fetchMessages = useCallback(async () => {
    try {
      const response = await fetch('/api/bus?source=bridge&limit=20')
      if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`)
      const data = await response.json()
      // Sort oldest first for conversation flow
      const sorted = [...data].sort((a: BridgeMessage, b: BridgeMessage) =>
        Date.parse(a.ts) - Date.parse(b.ts)
      )
      setRecentMessages(sorted)
      setLastFetch(new Date())

      // Check CC online status (last message from claude-cli or mission-control within 5 min)
      const lastCCMessage = data.find((m: BridgeMessage) =>
        m.from === 'claude-cli' || m.from === 'mission-control'
      )
      const isOnline = lastCCMessage && (Date.now() - Date.parse(lastCCMessage.ts)) < 5 * 60 * 1000
      setCcOnline(isOnline)
    } catch (err) {
      console.error('Failed to fetch bridge messages:', err)
    }
  }, [])

  // Initial fetch and polling
  useEffect(() => {
    fetchMessages()
    const interval = setInterval(fetchMessages, 3000)
    return () => clearInterval(interval)
  }, [fetchMessages])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [recentMessages.length])

  // Send command to Watson
  const sendCommand = async (command: string) => {
    if (!command.trim()) return

    setSending(true)
    setError(null)

    try {
      const response = await fetch('/api/watson/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: command }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || `Failed to send: ${response.status}`)
      }

      setCommandInput('')
      // Fetch immediately to show the sent message
      await fetchMessages()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send command')
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    sendCommand(commandInput)
  }

  const handleQuickCommand = (command: string) => {
    sendCommand(command)
  }

  return (
    <div className="p-6 space-y-6 h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-border pb-4 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🎩</span>
            <div>
              <h1 className="text-3xl font-bold text-foreground">Watson Command Center</h1>
              <p className="text-muted-foreground mt-1">
                Send commands and tasks to Watson via the CC Bridge
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* CC Executor Online status */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-md border ${
              ccOnline
                ? 'bg-green-500/20 text-green-400 border-green-500/30'
                : 'bg-muted text-muted-foreground border-border'
            }`}>
              <div className={`w-2 h-2 rounded-full ${ccOnline ? 'bg-green-500' : 'bg-muted-foreground'}`} />
              <span className="text-sm font-medium">CC Executor: {ccOnline ? 'Online' : 'Offline'}</span>
            </div>
            <button
              onClick={fetchMessages}
              className="px-3 py-1.5 bg-secondary text-foreground border border-border rounded-md text-sm font-medium hover:bg-secondary/80 transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Quick Commands */}
      <div className="shrink-0">
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Quick Commands</h3>
        <div className="flex flex-wrap gap-2">
          {QUICK_COMMANDS.map((cmd) => (
            <button
              key={cmd.label}
              onClick={() => handleQuickCommand(cmd.command)}
              disabled={sending}
              className="flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-lg hover:bg-secondary transition-colors disabled:opacity-50"
            >
              <span>{cmd.icon}</span>
              <span className="text-sm font-medium">{cmd.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="shrink-0 bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-red-400 font-bold">!</span>
            <span className="text-red-400 text-sm">{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-red-400/60 hover:text-red-400">
            &times;
          </button>
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 min-h-0 bg-card border border-border rounded-lg overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {recentMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                className="w-8 h-8 mb-2 opacity-50"
              >
                <path d="M2 3h12v9H2zM5 12v2M11 12v2" />
              </svg>
              <p className="text-sm">No bridge messages yet.</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Send a command to get started</p>
            </div>
          ) : (
            <>
              {recentMessages.map((msg) => {
                const direction = msg.data?.direction || msg.from
                const isToWatson = direction === 'to-watson' || msg.from === 'claude-cli' || msg.from === 'mission-control'
                const isFromWatson = direction === 'to-claude' || msg.from === 'watson'
                const rawData = msg.data as Record<string, unknown>
                const ref = rawData?.ref as string | undefined

                return (
                  <div
                    key={msg.id}
                    className={`flex ${isToWatson ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg p-3 ${
                        isToWatson
                          ? 'bg-primary/20 border border-primary/30'
                          : 'bg-blue-500/20 border border-blue-500/30'
                      }`}
                    >
                      {/* Header row */}
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`text-xs ${isToWatson ? 'text-primary' : 'text-blue-400'}`}>
                          {isToWatson ? '→ to Watson' : '← from Watson'}
                        </span>
                        <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${getTypeBadgeColor(msg.type)}`}>
                          {msg.type}
                        </span>
                        <span className="text-xs text-muted-foreground" title={msg.ts}>
                          {formatTime(msg.ts)}
                        </span>
                        <span className="text-xs text-muted-foreground/60">
                          {msg.from}
                        </span>
                      </div>

                      {/* Reply chain indicator */}
                      {ref && (
                        <div className="text-xs text-muted-foreground mb-1 pl-2 border-l-2 border-muted-foreground/30">
                          ↳ reply to {ref.slice(0, 8)}...
                        </div>
                      )}

                      {/* Content */}
                      <p className="text-sm text-foreground break-words whitespace-pre-wrap">
                        {msg.content || msg.message}
                      </p>
                    </div>
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Footer with last updated */}
        <div className="border-t border-border bg-secondary/30 px-4 py-2 text-xs text-muted-foreground flex justify-between items-center shrink-0">
          <span>{recentMessages.length} messages</span>
          {lastFetch && <span>Last updated: {lastFetch.toLocaleTimeString()}</span>}
        </div>
      </div>

      {/* Input area */}
      <form onSubmit={handleSubmit} className="shrink-0">
        <div className="flex gap-3">
          <input
            ref={inputRef}
            type="text"
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            placeholder="Type a command for Watson..."
            disabled={sending}
            className="flex-1 px-4 py-3 bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={sending || !commandInput.trim()}
            className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {sending ? (
              <>
                <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <path d="M14 2L2 8l4 2 2 4 6-12z" />
                  <path d="M14 2L6 10" />
                </svg>
                Send
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
