import { useEffect, useMemo, useRef, useState } from 'react'
import {
  initialSessionState,
  reduce,
  reduceAll,
  type SessionState,
} from '@observatory/core'
import { useEventStream } from '../hooks/useEventStream.js'
import { stagedPathologyFixture, twentyLaneFixture, type Fixture } from './fixtures.js'
import { buildOrganism, type Organism } from './model/organism.js'
import { Scene } from './render/Scene.js'
import { AttentionStrip } from './ui/AttentionStrip.js'
import { BurnStrip } from './ui/BurnStrip.js'
import { FleetTable } from './ui/FleetTable.js'
import './spike.css'

/**
 * SPIKE B — THE SIGIL ORGANISM. One page: attention strip, burn strip, the
 * organism, the fleet table.
 *
 * `1` live · `2` twenty synthetic lanes with second growth · `3` one of each
 * pathology. All three run the same code path — the fixtures are event logs,
 * folded by the same reducer the socket feeds.
 */

type Source = '1' | '2' | '3'

const SOURCE_NAMES: Record<Source, string> = {
  '1': 'LIVE',
  '2': '20 LANES',
  '3': 'PATHOLOGY',
}

export function SigilPage({ streamUrl = '/api/stream' }: { streamUrl?: string } = {}) {
  const [source, setSource] = useState<Source>(readInitialSource)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '1' || event.key === '2' || event.key === '3') {
        setSource(event.key)
        setSelected(null)
      }
      if (event.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const live = useEventStream<SessionState>(streamUrl, {
    initialState: initialSessionState(),
    reduce,
  })

  // Fixtures are folded once, against a clock frozen at mount: a staged
  // pathology must not quietly become a different pathology while it is read.
  const fixture = useMemo<Fixture | null>(() => {
    if (source === '1') return null
    const now = Date.now()
    return source === '2' ? twentyLaneFixture(now) : stagedPathologyFixture(now)
  }, [source])

  const fixtureState = useMemo(
    () => (fixture === null ? null : reduceAll(fixture.events)),
    [fixture],
  )

  // Live has no fixed clock, so it gets a slow tick — this drives the *values*
  // (ages, burn window), never an animation.
  const now = useTick(source === '1' ? 4_000 : 0)

  const organism: Organism = useMemo(() => {
    if (fixtureState !== null && fixture !== null) {
      return buildOrganism(fixtureState, {
        now: fixture.events[fixture.events.length - 1]?.ts ?? Date.now(),
        ...(fixture.manifest === undefined ? {} : { manifest: fixture.manifest }),
      })
    }
    return buildOrganism(live.state, { now })
  }, [fixtureState, fixture, live.state, now])

  useTabSignal(organism)

  return (
    <div className="sigil-page">
      <AttentionStrip organism={organism} selected={selected} onSelect={setSelected} />
      <BurnStrip organism={organism} />
      <main className="sigil-main">
        <div className="scene-frame">
          <Scene organism={organism} selected={selected} onSelect={setSelected} />
          <div className="scene-caption">
            <span className="wordmark">OBSERVATORY</span>
            <span className="mono scene-repo">
              {organism.repoName ?? '—'} · {organism.mainBranch ?? 'main'}
            </span>
          </div>
        </div>
        <FleetTable organism={organism} selected={selected} onSelect={setSelected} />
      </main>
      <footer className="strip provenance">
        <SourceTabs source={source} onChange={setSource} status={live.status} />
        <span className="mono provenance-note">
          keys 1 · 2 · 3 switch source, esc clears selection
        </span>
      </footer>
    </div>
  )
}

function SourceTabs({
  source,
  onChange,
  status,
}: {
  source: Source
  onChange: (next: Source) => void
  status: string
}) {
  return (
    <div className="source-tabs">
      {(['1', '2', '3'] as const).map((key) => (
        <button
          key={key}
          type="button"
          className={`source-tab${source === key ? ' is-active' : ''}`}
          onClick={() => onChange(key)}
        >
          <span className="mono source-key">{key}</span>
          {SOURCE_NAMES[key]}
        </button>
      ))}
      <span className="mono source-status" data-status={status}>
        {source === '1' ? `sse ${status}` : 'synthetic log'}
      </span>
    </div>
  )
}

/** A clock that ticks only when asked. `0` means "never" — fixtures are frozen. */
function useTick(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (intervalMs === 0) return
    const handle = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(handle)
  }, [intervalMs])
  return now
}

/**
 * Ruling 8: at NEEDS-YOU and above the tab itself says so. The attention strip
 * is the single source of truth, so this reads the same list it renders.
 */
function useTabSignal(organism: Organism): void {
  const original = useRef<string | null>(null)
  useEffect(() => {
    original.current ??= document.title
    const count = organism.attention.length
    const worst = organism.attention[0]?.ladder
    document.title = count === 0 ? (original.current ?? 'Observatory') : `● ${count} need you`
    const link =
      document.querySelector<HTMLLinkElement>('link[rel="icon"]') ??
      document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' }))
    link.href = faviconFor(count === 0 ? null : (worst ?? 'needs-you'))
  }, [organism])
}

function faviconFor(ladder: string | null): string {
  const fill = ladder === null ? '#4deaff' : ladder === 'broken' ? '#ff3d7f' : '#ffc857'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#05060a"/><circle cx="8" cy="8" r="${ladder === null ? 2.6 : 4.4}" fill="${fill}"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function readInitialSource(): Source {
  const value = new URLSearchParams(window.location.search).get('fixture')
  return value === '2' || value === '3' ? value : '1'
}
