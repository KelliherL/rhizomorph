import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { initialSessionState, reduceAll, type ObservatoryEvent, type SessionState } from '@observatory/core'
import { buildFleet, type Fleet } from './data/fleet.js'
import { createLiveFeed } from './feed/live.js'
import type { Feed, FixtureId } from './feed/types.js'
import { createSyntheticFeed } from './fixtures/synthetic.js'
import { Mycelium } from './scene/Mycelium.js'
import { PulseField, type LaneResolver } from './scene/pulses.js'
import { AttentionStrip } from './ui/AttentionStrip.js'
import { BurnStrip } from './ui/BurnStrip.js'
import { FleetTable } from './ui/FleetTable.js'
import { ProvenanceBar } from './ui/ProvenanceBar.js'
import './spike.css'

/**
 * SPIKE C — MYCELIUM PULSE-NETWORK.
 *
 * One page: attention strip and burn strip docked at the top, the network in the
 * middle, the fleet table beside it, provenance and gaps along the bottom.
 *
 * The whole page is four views of one derived object (`buildFleet`), which is
 * itself a read of one folded event log. Keys 1/2/3 swap which log: the real
 * stream, a twenty-lane synthetic fleet, or one lane per pathology.
 */
export function SpikeApp({ streamUrl = '/api/stream' }: { streamUrl?: string } = {}) {
  const [fixture, setFixture] = useState<FixtureId>('live')
  const [feed, setFeed] = useState<Feed | null>(null)

  // The fold lives in a ref: 20k replayed events must not be 20k React renders.
  const stateRef = useRef<SessionState>(initialSessionState())
  const fieldRef = useRef(new PulseField())
  const [version, setVersion] = useState(0)
  const [clock, setClock] = useState(() => Date.now())

  const [userFocus, setUserFocus] = useState<{ id: string | null } | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)

  // Lane resolution needs the *current* fleet, and the feed callback must not be
  // rebuilt every time the fleet is. A ref bridges the two.
  const resolverRef = useRef<LaneResolver>(() => null)

  useEffect(() => {
    stateRef.current = initialSessionState()
    fieldRef.current = new PulseField()
    setUserFocus(null)
    setVersion((v) => v + 1)

    const next = fixture === 'live' ? createLiveFeed(streamUrl) : createSyntheticFeed(fixture)
    setFeed(next)

    const unsubscribe = next.subscribe((batch) => {
      stateRef.current = reduceAll(batch.events, stateRef.current)
      // Rule one of the motion law here: history builds state and lights nothing.
      if (!batch.historical) {
        fieldRef.current.ingest(batch.events, resolverRef.current, Date.now())
      }
      setVersion((v) => v + 1)
    })

    return () => {
      unsubscribe()
      next.stop()
    }
  }, [fixture, streamUrl])

  // Derived state is rebuilt on a beat, not per event: the selectors are cheap
  // but not free, and a 1 Hz clock is faster than an operator's glance anyway.
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const fleet = useMemo(
    () =>
      buildFleet(stateRef.current, {
        now: clock,
        manifest: feed?.manifest ?? null,
      }),
    // `version` is the fold's identity; `clock` is the passage of time. Both
    // genuinely change the answer, and nothing else does.
    [version, clock, feed],
  )

  useEffect(() => {
    resolverRef.current = buildResolver(fleet)
  }, [fleet])

  // The spotlight follows the ladder until a human overrules it — the worst lane
  // is the default subject, which is what makes it the most salient object
  // without anyone having to click anything.
  const autoFocus = useMemo(() => {
    const worst = fleet.attention.find(
      (item) =>
        (item.rank === 'broken' || item.rank === 'needs-you') &&
        // Only a lane can be spotlit. A collision has no single lane to blame and
        // a collector fault is not on the network at all.
        item.kind !== 'collision' &&
        item.kind !== 'collector',
    )
    return worst === undefined ? null : worst.laneId
  }, [fleet])
  const focusId = userFocus === null ? autoFocus : userFocus.id

  const onFocus = useCallback((laneId: string | null) => setUserFocus({ id: laneId }), [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '1') setFixture('live')
      else if (event.key === '2') setFixture('fleet20')
      else if (event.key === '3') setFixture('pathology')
      else if (event.key === 'Escape') setUserFocus({ id: null })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useTabSignal(fleet)

  if (feed === null) return null

  return (
    <div className="spike-shell">
      <header className="top-dock">
        <AttentionStrip fleet={fleet} focusId={focusId} onFocus={onFocus} />
        <BurnStrip fleet={fleet} />
      </header>

      <main className="stage">
        <section className="scene-pane">
          <Mycelium
            fleet={fleet}
            field={fieldRef.current}
            focusId={focusId}
            onSelect={onFocus}
            hoverId={hoverId}
            onHover={setHoverId}
          />
          <span className="scene-tag">
            {fleet.root.repoName ?? 'repo'} · {fleet.evidence.lanes} lanes
          </span>
        </section>
        <FleetTable
          fleet={fleet}
          focusId={focusId}
          hoverId={hoverId}
          onFocus={onFocus}
          onHover={setHoverId}
        />
      </main>

      <ProvenanceBar fleet={fleet} feed={feed} onFixture={setFixture} />
    </div>
  )
}

/**
 * Which lane an event belongs to. Telemetry names a `lane` handle, git names a
 * branch or a worktree path, tmux names neither — so the resolver tries all
 * three keys the fleet was joined on and gives up rather than guessing.
 */
function buildResolver(fleet: Fleet): LaneResolver {
  const byKey = new Map<string, string>()
  for (const lane of fleet.lanes) {
    byKey.set(lane.id, lane.id)
    if (lane.handle !== null) byKey.set(lane.handle, lane.id)
    if (lane.branch !== null) byKey.set(lane.branch, lane.id)
    if (lane.worktreePath !== null) byKey.set(lane.worktreePath, lane.id)
  }

  return (event: ObservatoryEvent): string | null => {
    const payload = event.payload as Record<string, unknown>
    for (const key of ['lane', 'branch', 'worktreePath', 'path'] as const) {
      const value = payload[key]
      if (typeof value !== 'string') continue
      const laneId = byKey.get(value)
      if (laneId !== undefined) return laneId
    }
    return null
  }
}

/**
 * Ruling 8: at NEEDS-YOU and above the tab title flips and the favicon takes a
 * badge, so a background second monitor still raises its hand.
 */
function useTabSignal(fleet: Fleet): void {
  useEffect(() => {
    const needsYou = fleet.attention.filter(
      (item) => item.rank === 'needs-you' || item.rank === 'broken',
    ).length

    document.title =
      needsYou > 0 ? `● ${needsYou} need you — Observatory` : 'the Observatory — mycelium'

    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    const ctx = canvas.getContext('2d')
    if (ctx === null) return

    ctx.fillStyle = '#05060a'
    ctx.fillRect(0, 0, 32, 32)
    ctx.strokeStyle = needsYou > 0 ? '#ffc857' : '#5c667a'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(16, 16, 9, 0, Math.PI * 2)
    ctx.stroke()
    if (needsYou > 0) {
      ctx.fillStyle = fleet.rank === 'broken' ? '#ff3d68' : '#ffc857'
      ctx.beginPath()
      ctx.arc(24, 8, 7, 0, Math.PI * 2)
      ctx.fill()
    }

    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (link === null) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    link.href = canvas.toDataURL('image/png')
  }, [fleet])
}
