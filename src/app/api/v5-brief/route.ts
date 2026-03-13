import { NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const BRIEF_PATH = path.join(
  process.env.HOME ?? '/Users/watson',
  '.openclaw/agents/main/workspace/data/v5-brief-latest.json'
)

export async function GET() {
  try {
    const raw = await readFile(BRIEF_PATH, 'utf-8')
    const data = JSON.parse(raw)
    return NextResponse.json(data)
  } catch {
    // File doesn't exist yet or unreadable — return empty state
    return NextResponse.json(
      { headline: null, recommendation: null, date: null, generatedAt: null },
      { status: 200 }
    )
  }
}
