import { NextRequest, NextResponse } from 'next/server'
import Database from 'better-sqlite3'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import path from 'node:path'

const DISCRAWL_DB_PATH = '/Users/watson/.discrawl/discrawl.db'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || 'overview'

    const db = new Database(DISCRAWL_DB_PATH, { readonly: true })
    
    // Apply optimizations for the connection
    db.pragma('mmap_size = 268435456')
    db.pragma('cache_size = -16000')

    if (action === 'overview') {
      const stats = db.prepare(`
        SELECT 
          (SELECT COUNT(*) FROM messages) as message_count,
          (SELECT COUNT(*) FROM channels) as channel_count,
          (SELECT COUNT(*) FROM members) as member_count
      `).get() as any

      const recentActivity = db.prepare(`
        SELECT date(created_at) as date, COUNT(*) as count 
        FROM messages 
        WHERE created_at > date('now', '-7 days')
        GROUP BY date 
        ORDER BY date DESC
      `).all()

      db.close()
      return NextResponse.json({ stats, recentActivity })
    }

    if (action === 'mentions') {
      const limit = parseInt(searchParams.get('limit') || '10')
      const mentions = db.prepare(`
        SELECT 
          m.id as message_id,
          c.name as channel_name,
          u.username as author_name,
          m.content,
          m.created_at
        FROM mention_events e
        JOIN messages m ON m.id = e.message_id
        LEFT JOIN channels c ON c.id = m.channel_id
        LEFT JOIN members u ON u.user_id = m.author_id
        WHERE e.target_id = '1469558808337449011' -- Watson's ID
        ORDER BY m.created_at DESC
        LIMIT ?
      `).all(limit)

      db.close()
      return NextResponse.json({ mentions })
    }

    if (action === 'search') {
      const query = searchParams.get('q')
      const limit = parseInt(searchParams.get('limit') || '20')
      if (!query) return NextResponse.json({ error: 'Missing query' }, { status: 400 })

      const results = db.prepare(`
        SELECT 
          m.id as message_id,
          c.name as channel_name,
          u.username as author_name,
          m.content,
          m.created_at
        FROM message_fts f
        JOIN messages m ON m.id = f.message_id
        LEFT JOIN channels c ON c.id = m.channel_id
        LEFT JOIN members u ON u.user_id = m.author_id
        WHERE f.content MATCH ?
        ORDER BY m.created_at DESC
        LIMIT ?
      `).all(query, limit)

      db.close()
      return NextResponse.json({ results })
    }

    db.close()
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    logger.error({ err: error }, 'Discord API error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
