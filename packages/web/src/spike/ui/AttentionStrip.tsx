import { formatSpan, type Fleet } from '../data/fleet.js'
import { glyphFor, LADDER_WORD, RANK_CLASS, wordFor } from './glyphs.js'

export interface AttentionStripProps {
  fleet: Fleet
  focusId: string | null
  onFocus: (laneId: string | null) => void
}

/**
 * How many named items fit before the strip starts counting instead. Four, so
 * the chips never clip: a triage line that runs off the edge of the screen has
 * stopped being a triage line. Everything past four is counted, and the fleet
 * table below names all of it.
 */
const MAX_CHIPS = 4

/**
 * The first-second question: does anything need me?
 *
 * Calm state carries its evidence (ruling 14): never a bare "all clear", always
 * the count of what was checked to earn it. Otherwise the items are named — lane,
 * why, how long — and clicking one puts the scene's spotlight on it, which is
 * ruling 5's click-to-jump with the scene as the destination.
 */
export function AttentionStrip({ fleet, focusId, onFocus }: AttentionStripProps) {
  const calm = fleet.rank === 'calm'
  const needsYou = fleet.attention.filter(
    (item) => item.rank === 'needs-you' || item.rank === 'broken',
  )
  const notices = fleet.attention.filter((item) => item.rank === 'notice')

  return (
    <div className="attention-strip">
      <span className={`ladder-pill ${RANK_CLASS[fleet.rank]}`}>
        <span className="ladder-dot" aria-hidden />
        {calm
          ? LADDER_WORD.calm
          : needsYou.length > 0
            ? `${needsYou.length} NEED ATTENTION`
            : `${notices.length} NOTICE`}
      </span>

      {calm ? (
        <p className="evidence">
          <span className="mono">{fleet.evidence.lanes}</span> lanes threaded ·{' '}
          <span className="mono">{fleet.evidence.working}</span> working ·{' '}
          <span className="mono">{fleet.evidence.commitsHome}</span> commits home · collisions{' '}
          <span className="mono">{fleet.evidence.collisions}</span>{' '}
          <span className="evidence-dim">
            (checked <span className="mono">{fleet.evidence.branchesChecked}</span> branches /{' '}
            <span className="mono">{fleet.evidence.filesChecked}</span> files)
          </span>
        </p>
      ) : (
        <div className="chips">
          {fleet.attention.slice(0, MAX_CHIPS).map((item) => (
            <button
              key={item.id}
              type="button"
              className={`chip ${RANK_CLASS[item.rank]} ${
                item.laneId !== '' && focusId === item.laneId ? 'chip-on' : ''
              }`}
              title={item.evidence}
              disabled={item.laneId === ''}
              onClick={() => onFocus(focusId === item.laneId ? null : item.laneId)}
            >
              <span className="chip-glyph" aria-hidden>
                {glyphFor(item.kind)}
              </span>
              <span className="chip-lane">{item.label}</span>
              <span className="chip-why">
                {wordFor(item.kind)}
                {item.inferred ? '~' : ''}
              </span>
              {item.forMs === null ? null : <span className="chip-age mono">{formatSpan(item.forMs)}</span>}
            </button>
          ))}
          {fleet.attention.length > MAX_CHIPS ? (
            <span className="chip-more mono">+{fleet.attention.length - MAX_CHIPS}</span>
          ) : null}
        </div>
      )}
    </div>
  )
}
