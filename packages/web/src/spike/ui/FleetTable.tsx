import { formatTokenBreakdown, formatTokens, formatUsd } from '../../lib/format.js'
import { formatSpan, type Fleet, type Filament, type Lane } from '../data/fleet.js'
import {
  ACTIVITY_GLYPH,
  ACTIVITY_WORD,
  PATHOLOGY_GLYPH,
  PATHOLOGY_WORD,
  RANK_CLASS,
} from './glyphs.js'

export interface FleetTableProps {
  fleet: Fleet
  focusId: string | null
  hoverId: string | null
  onFocus: (laneId: string | null) => void
  onHover: (laneId: string | null) => void
}

/**
 * The fleet: one row per lane, compact enough that twenty fit without scrolling
 * (ruling 7). Labels are sans, every number is monospace with tabular numerals,
 * and the only colour in the table is a fault's own glyph and word — the same
 * pair the scene draws at that lane's node.
 *
 * Hovering a row lights its thread in the scene and vice versa: the table is the
 * index, the scene is the picture, and they are the same object.
 */
export function FleetTable({ fleet, focusId, hoverId, onFocus, onHover }: FleetTableProps) {
  return (
    <div className="fleet">
      <table className="fleet-table">
        {/*
          Fixed widths, declared once. A dense table whose columns are sized by
          content shifts every time a number gains a digit, and a row that moves
          under the eye is a row you have to re-read.
        */}
        <colgroup>
          <col style={{ width: '18px' }} />
          <col style={{ width: 'auto' }} />
          <col style={{ width: '84px' }} />
          <col style={{ width: '48px' }} />
          <col style={{ width: '52px' }} />
          <col style={{ width: '32px' }} />
          <col style={{ width: '36px' }} />
          <col style={{ width: '28px' }} />
          <col style={{ width: '28px' }} />
          <col style={{ width: '56px' }} />
          <col style={{ width: '82px' }} />
        </colgroup>
        <thead>
          <tr>
            <th className="col-sigil" />
            <th className="col-lane">lane</th>
            <th className="col-state">state</th>
            <th className="num">out</th>
            <th className="num">$</th>
            <th className="num">req</th>
            <th className="num">tool</th>
            <th className="num">ahd</th>
            <th className="num">drt</th>
            <th className="num">age</th>
            <th className="col-threads">threads</th>
          </tr>
        </thead>
        <tbody>
          {fleet.lanes.map((lane) => (
            <Row
              key={lane.id}
              lane={lane}
              focused={focusId === lane.id}
              hovered={hoverId === lane.id}
              onFocus={onFocus}
              onHover={onHover}
            />
          ))}
        </tbody>
      </table>
      {fleet.lanes.length === 0 ? (
        <p className="fleet-empty">
          NO LANES YET — the git collector has not reported a worktree — run:{' '}
          <span className="mono">observatory</span>
        </p>
      ) : null}
    </div>
  )
}

interface RowProps {
  lane: Lane
  focused: boolean
  hovered: boolean
  onFocus: (laneId: string | null) => void
  onHover: (laneId: string | null) => void
}

function Row({ lane, focused, hovered, onFocus, onHover }: RowProps) {
  // The worst fault owns the row's glyph; the rest are counted in the title.
  const fault = lane.pathologies[0]
  const glyph = fault === undefined ? ACTIVITY_GLYPH[lane.activity] : PATHOLOGY_GLYPH[fault.kind]
  const word = fault === undefined ? ACTIVITY_WORD[lane.activity] : PATHOLOGY_WORD[fault.kind]

  const className = [
    'fleet-row',
    RANK_CLASS[lane.rank],
    focused ? 'row-focus' : '',
    hovered ? 'row-hover' : '',
    lane.activity === 'done' ? 'row-done' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <tr
      className={className}
      onMouseEnter={() => onHover(lane.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onFocus(focused ? null : lane.id)}
    >
      <td className="col-sigil" aria-hidden>
        {glyph}
      </td>
      <td className="col-lane" title={lane.worktreePath ?? lane.id}>
        {lane.label}
      </td>
      <td className="col-state">
        {word}
        {fault?.inferred ? <span className="inferred" title="inferred from pane state">~</span> : null}
        {lane.pathologies.length > 1 ? (
          <span className="also mono" title={lane.pathologies.map((p) => p.evidence).join(' · ')}>
            +{lane.pathologies.length - 1}
          </span>
        ) : null}
      </td>
      <td className="num" title={formatTokenBreakdown(lane.tokens)}>
        {formatTokens(lane.outputTokens)}
      </td>
      <td className="num">
        {lane.costEventCount === 0 ? (
          <span className="dim">—</span>
        ) : (
          formatUsd(lane.costUsd)
        )}
      </td>
      <td className="num">{lane.requestCount}</td>
      <td className="num">{lane.toolCallCount}</td>
      <td className="num">{lane.aheadOfMain === 0 ? <span className="dim">0</span> : lane.aheadOfMain}</td>
      <td className="num">{lane.dirtyCount === 0 ? <span className="dim">0</span> : lane.dirtyCount}</td>
      <td className="num">{lane.ageMs === null ? <span className="dim">—</span> : formatSpan(lane.ageMs)}</td>
      {/*
        Ruling 20 is about *subagent* visibility, so this column shows the
        second-generation threads and leaves `main` implied — main is the lane
        itself. An em dash means no source reported a thread at all, which is a
        different fact from "the work was all on the main thread" and reads as one.
      */}
      <td className="col-threads" title={threadTitle(lane)}>
        {lane.filaments.length === 0 ? (
          <span className="dim">—</span>
        ) : branching(lane).length === 0 ? (
          <span className="dim">main only</span>
        ) : (
          branching(lane).map((filament) => (
            <span key={filament.thread ?? 'unknown'} className="filament-tag">
              {SHORT_THREAD[filament.thread ?? 'unknown']}
              <span className="mono filament-size">{formatTokens(filament.outputTokens)}</span>
            </span>
          ))
        )}
      </td>
    </tr>
  )
}

const SHORT_THREAD: Record<string, string> = {
  subagent: 'sub',
  auxiliary: 'aux',
  unknown: 'unk',
}

/** Threads other than the lane's own trunk — the ones worth a row of their own. */
function branching(lane: Lane): Filament[] {
  return lane.filaments.filter((filament) => filament.thread !== 'main')
}

function threadTitle(lane: Lane): string {
  if (lane.filaments.length === 0) return 'no source reported a thread for this lane'
  return lane.filaments
    .map((f) => `${f.thread ?? 'unknown'} ${formatTokens(f.outputTokens)} out · ${f.requestCount} req`)
    .join(' · ')
}
