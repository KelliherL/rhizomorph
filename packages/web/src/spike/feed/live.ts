import { EVENT_TYPES, parseEvent } from '@observatory/core'
import { NEWS_GRACE_MS, type Feed, type FeedBatch } from './types.js'

/**
 * Fixture 1 — the real stream. The same `/api/stream` SSE endpoint the shipped
 * dashboard reads, no private path and no mock.
 *
 * The server replays the session so far before it starts live-tailing, so the
 * first few hundred milliseconds are history. Rather than guess by arrival
 * time, each event is judged by its own `ts`: anything older than the moment we
 * connected (less a grace window for the tail of the replay) is history.
 */
export function createLiveFeed(url: string): Feed {
  const listeners = new Set<(batch: FeedBatch) => void>()
  const connectedAt = Date.now()
  let source: EventSource | null = null

  // Batch per animation frame: a replay burst of 20k events must not cause
  // 20k React updates, and a live tick usually arrives in small clumps anyway.
  let pending: FeedBatch | null = null
  let scheduled = false

  const flush = () => {
    scheduled = false
    const batch = pending
    pending = null
    if (batch === null || batch.events.length === 0) return
    for (const listener of listeners) listener(batch)
  }

  const push = (batch: FeedBatch) => {
    // Never mix news with history in one batch, or the pulse layer cannot tell
    // them apart. A boundary flush is cheap and happens once per connection.
    if (pending !== null && pending.historical !== batch.historical) flush()
    pending =
      pending === null
        ? batch
        : { historical: batch.historical, events: [...pending.events, ...batch.events] }
    if (!scheduled) {
      scheduled = true
      requestAnimationFrame(flush)
    }
  }

  const handle = (message: MessageEvent<string>) => {
    let payload: unknown
    try {
      payload = JSON.parse(message.data)
    } catch {
      return
    }
    const parsed = parseEvent(payload)
    if (!parsed.ok) return
    push({
      events: [parsed.event],
      historical: parsed.event.ts < connectedAt - NEWS_GRACE_MS,
    })
  }

  source = new EventSource(url)
  source.onmessage = handle
  for (const type of EVENT_TYPES) source.addEventListener(type, handle as EventListener)

  return {
    id: 'live',
    label: 'LIVE',
    provenance: `SSE ${url} · real collectors`,
    // Off-fence needs `.swarm/lanes.json`, which dispatch does not write yet.
    // The gap voice says so rather than inventing fences for real lanes.
    manifest: null,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    stop() {
      listeners.clear()
      for (const type of EVENT_TYPES) source?.removeEventListener(type, handle as EventListener)
      source?.close()
      source = null
    },
  }
}
