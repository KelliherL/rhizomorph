import type { Fleet } from '../data/fleet.js'
import type { Feed, FixtureId } from '../feed/types.js'

export interface ProvenanceBarProps {
  fleet: Fleet
  feed: Feed
  onFixture: (id: FixtureId) => void
}

const FIXTURES: readonly { id: FixtureId; key: string; label: string }[] = [
  { id: 'live', key: '1', label: 'LIVE' },
  { id: 'fleet20', key: '2', label: '20-LANE' },
  { id: 'pathology', key: '3', label: 'PATHOLOGY' },
]

/**
 * Ambient provenance (ruling 15) plus the gap voice (ruling 12). Everything on
 * this line is about *where the numbers came from* and *what is missing* — the
 * quiet honesty bar under an instrument that otherwise claims a lot.
 */
export function ProvenanceBar({ fleet, feed, onFixture }: ProvenanceBarProps) {
  return (
    <div className="provenance">
      <div className="fixtures">
        {FIXTURES.map((fixture) => (
          <button
            key={fixture.id}
            type="button"
            className={`fixture${feed.id === fixture.id ? ' fixture-on' : ''}`}
            onClick={() => onFixture(fixture.id)}
          >
            <span className="fixture-key mono">{fixture.key}</span>
            {fixture.label}
          </button>
        ))}
      </div>

      <span className="prov-source">{feed.provenance}</span>

      <span className="prov-counts mono">
        {fleet.eventCount} events · {fleet.totals.origins.length > 0 ? fleet.totals.origins.join('+') : 'no telemetry'}
      </span>

      {/*
        Ruling 14's ambient line, always shown and always with its evidence: a
        zero that says what it checked, never a bare reassurance. When there *is*
        a collision it is a ladder item up in the strip; this line still reports
        the sweep that found it.
      */}
      <span className="prov-counts">
        collisions <span className="mono">{fleet.evidence.collisions}</span>
        <span className="prov-dim">
          {' '}
          — checked <span className="mono">{fleet.evidence.branchesChecked}</span> branches /{' '}
          <span className="mono">{fleet.evidence.filesChecked}</span> files
        </span>
      </span>

      <div className="gaps">
        {fleet.gaps.map((gap) => (
          <span className="gap" key={gap.what}>
            <span className="gap-what">{gap.what}</span>
            <span className="gap-why"> — {gap.why} — run: </span>
            <span className="mono gap-command">{gap.command}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
