import type { ObservatoryEvent } from '@observatory/core'
import type { LaneManifest } from '../data/fences.js'

export type FixtureId = 'live' | 'fleet20' | 'pathology'

/**
 * Events arriving from a feed, tagged with whether they are *news*.
 *
 * This tag is what keeps the scene honest. A stream replays the whole session
 * on connect, and firing a pulse for each of three thousand historical facts
 * would be a fireworks display, not an instrument. Historical events build
 * state and light nothing; only news moves.
 */
export interface FeedBatch {
  events: ObservatoryEvent[]
  historical: boolean
}

export interface Feed {
  id: FixtureId
  label: string
  /** Where this fixture's data comes from — shown in the provenance line. */
  provenance: string
  /** The lane manifest for this fixture, or null when there isn't one. */
  manifest: LaneManifest | null
  subscribe(listener: (batch: FeedBatch) => void): () => void
  stop(): void
}

/** How stale an event may be and still count as news, on connect. */
export const NEWS_GRACE_MS = 4_000
