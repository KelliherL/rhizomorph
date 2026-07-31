import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { ObservatoryEvent } from '@observatory/core'
import { useEventStream, type EventSourceFactory } from '../hooks/useEventStream.js'
import { foldRawEvents, initialRawStreamState } from '../app/streamState.js'
import { AttentionBar, FleetTable, Footer } from './Panels.js'
import { Scene } from './Scene.js'
import { buildFleet, type Fleet, type LaneManifest } from './fleet.js'
import { fixture20, fixtureStaged } from './fixtures.js'
import './spike.css'

/**
 * SPIKE A — CONSTELLATION REFINED. One page.
 *
 *   1  the live stream, as-is
 *   2  a twenty-lane synthetic fleet (ruling 22's scale test)
 *   3  a staged fixture: exactly one of each pathology
 *
 * Fixtures 2 and 3 are evaluated at a frozen `now` — they are *staged moments*,
 * so a screenshot and a live tab five minutes apart show the same thing. The
 * live view runs off the wall clock, as it must.
 */

type FixtureId = '1' | '2' | '3'

const FIXTURES: { id: FixtureId; label: string }[] = [
  { id: '1', label: 'live' },
  { id: '2', label: '20 lanes' },
  { id: '3', label: 'pathology' },
]

export interface SpikePageProps {
  streamUrl?: string
  createSource?: EventSourceFactory
  /** Test seam: pin the clock so a render is deterministic. */
  clock?: () => number
}

export function SpikePage({
  streamUrl = '/api/stream',
  createSource,
  clock = Date.now,
}: SpikePageProps): ReactElement {
  const [fixture, setFixture] = useState<FixtureId>('1')
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [demoLanding, setDemoLanding] = useState(0)

  const live = useEventStream(streamUrl, {
    initialState: initialRawStreamState,
    reduce: foldRawEvents,
    createSource,
  })

  const liveManifest = useLaneManifest()
  const anchor = useRef(clock()).current
  const staged = useMemo(
    () => ({ '2': fixture20(anchor), '3': fixtureStaged(anchor) }) as const,
    [anchor],
  )

  const tick = useClock(fixture === '1' ? 2_000 : null, clock)

  const source: { events: readonly ObservatoryEvent[]; manifest: LaneManifest | null; now: number } =
    fixture === '1'
      ? { events: live.state.events, manifest: liveManifest, now: tick }
      : { events: staged[fixture].events, manifest: staged[fixture].manifest, now: anchor }

  const fleet: Fleet = useMemo(
    () => buildFleet(source.events, { now: source.now, manifest: source.manifest }),
    [source.events, source.now, source.manifest],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === '1' || event.key === '2' || event.key === '3') {
        setFixture(event.key)
        setFocusId(null)
      }
      // `L` replays a landing streak so the one event animation is reviewable
      // on a frozen fixture. Live data fires it on its own.
      if (event.key === 'l' || event.key === 'L') setDemoLanding((n) => n + 1)
      if (event.key === 'Escape') setFocusId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Tab title + favicon badge at NEEDS-YOU and above (ruling 8).
  useEffect(() => {
    const count = fleet.attention.length
    document.title = count === 0 ? 'the Observatory' : `● ${count} need you — the Observatory`
  }, [fleet.attention.length])

  const hovered = fleet.lanes.find((lane) => lane.id === hoveredId) ?? null
  const status =
    fixture === '1'
      ? `live · ${live.status}`
      : fixture === '2'
        ? 'fixture 2 · 20-lane synthetic'
        : 'fixture 3 · staged pathologies'

  return (
    <div className="pg">
      <AttentionBar fleet={fleet} onJump={setFocusId} />

      <div className="pg-main">
        <section className="panel">
          <header className="panel-hd">
            <span className="label">the fleet</span>
            <span className="num" style={{ fontSize: 11, color: 'var(--ink-dim)' }}>
              {fleet.repoName ?? '—'} / {fleet.mainBranch ?? 'main'} · {fleet.lanes.length} lanes
            </span>
            <span className="spacer" />
            <div className="fx">
              {FIXTURES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  data-on={fixture === entry.id ? '1' : '0'}
                  onClick={() => setFixture(entry.id)}
                >
                  <kbd>{entry.id}</kbd>
                  {entry.label}
                </button>
              ))}
            </div>
          </header>
          <div className="scene">
            {fixture === '1' && fleet.lanes.length === 0 ? (
              <EmptyLive status={live.status} />
            ) : (
              <Scene
                fleet={fleet}
                hoveredId={hoveredId ?? focusId}
                onHover={setHoveredId}
                demoLanding={demoLanding}
              />
            )}
          </div>
        </section>

        <section className="panel">
          <header className="panel-hd">
            <span className="label">lanes</span>
            <span className="num" style={{ fontSize: 11, color: 'var(--ink-dim)' }}>
              attention first, then output
            </span>
            <span className="spacer" />
            <span className="num" style={{ fontSize: 10, color: 'var(--ink-ghost)' }}>
              1/2/3 fixture · L landing
            </span>
          </header>
          <FleetTable
            fleet={fleet}
            hoveredId={hoveredId}
            focusId={focusId}
            onHover={setHoveredId}
          />
        </section>
      </div>

      <Footer fleet={fleet} status={status} hovered={hovered} />
    </div>
  )
}

/** Law 12 applied to the emptiest state there is. */
function EmptyLive({ status }: { status: string }): ReactElement {
  return (
    <div
      style={{
        height: '100%',
        display: 'grid',
        placeItems: 'center',
        textAlign: 'center',
        gap: 8,
        padding: 24,
      }}
    >
      <div>
        <div className="label" style={{ color: 'var(--needs)', marginBottom: 6 }}>
          no live stream ({status})
        </div>
        <div className="num" style={{ color: 'var(--ink-lo)', fontSize: 12 }}>
          the fleet is unobservable — run:{' '}
          <code
            style={{
              background: 'var(--sf-raise)',
              padding: '2px 6px',
              borderRadius: 2,
              color: 'var(--ink-mid)',
            }}
          >
            npm run dev:server
          </code>
        </div>
        <div className="num" style={{ color: 'var(--ink-dim)', fontSize: 11, marginTop: 10 }}>
          press 2 or 3 for a synthetic fleet
        </div>
      </div>
    </div>
  )
}

/**
 * The lane manifest for live data (ruling 19). Served as a static file until
 * `dispatch.sh` writes `.swarm/lanes.json` for real; absent, off-fence stays
 * undetectable and the gap voice says so rather than the UI implying safety.
 */
function useLaneManifest(): LaneManifest | null {
  const [manifest, setManifest] = useState<LaneManifest | null>(null)
  useEffect(() => {
    let cancelled = false
    void fetch('/lanes.json')
      .then((response) => (response.ok ? response.json() : null))
      .then((value: unknown) => {
        if (cancelled || value === null || typeof value !== 'object') return
        setManifest(value as LaneManifest)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])
  return manifest
}

function useClock(intervalMs: number | null, clock: () => number): number {
  const [now, setNow] = useState(clock)
  useEffect(() => {
    if (intervalMs === null) return
    const id = setInterval(() => setNow(clock()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs, clock])
  return now
}
