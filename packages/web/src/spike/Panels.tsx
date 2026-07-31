import { useEffect, useRef, useState, type ReactElement } from 'react'
import { HUE } from './palette.js'
import { MiniSigil } from './sigils.js'
import {
  formatAge,
  formatDuration,
  formatRate,
  formatRatio,
  formatTokenBreakdown,
  formatTokens,
  formatUsd,
} from './format.js'
import {
  PATHOLOGY_RUNG,
  PATHOLOGY_WORD,
  RUNG_ORDER,
  type Fleet,
  type Gap,
  type LaneVital,
  type Pathology,
} from './fleet.js'

/**
 * SPIKE A — the reading surfaces.
 *
 * Attention strip and burn strip share one bar (ruling 13). The fleet table is
 * the dense half: 21px rows, mono tabular numerals, contrast spent on the
 * numbers and nowhere else.
 */

// ── attention strip ─────────────────────────────────────────────────────────

export function AttentionBar({
  fleet,
  onJump,
}: {
  fleet: Fleet
  onJump: (id: string) => void
}): ReactElement {
  const pulse = usePulse(fleet.attention.length)
  const hue = HUE[fleet.rung]
  const notices = fleet.lanes.filter((lane) => lane.rung === 'notice')
  const collisions = fleet.evidence.collisionFiles

  return (
    <div className="bar">
      <div
        className="att"
        style={{ ['--rung' as string]: hue }}
        data-pulse={pulse ? 'on' : 'off'}
        key={pulse ? 'pulse' : 'steady'}
      >
        <div className="att-verdict">
          <MiniSigil kind={leadPathology(fleet)} hue={hue} size={15} />
          <span className="att-word">{verdict(fleet)}</span>
        </div>

        {fleet.rung === 'calm' ? (
          <span className="att-evidence num">{evidenceLine(fleet)}</span>
        ) : (
          <div className="att-items">
            {[...fleet.attention, ...(fleet.attention.length === 0 ? notices : [])].map((lane) => (
              <button
                key={lane.id}
                type="button"
                className="att-chip num"
                style={{ ['--chip-hue' as string]: HUE[lane.rung] }}
                onClick={() => onJump(lane.id)}
                title={lane.reason ?? undefined}
              >
                <MiniSigil kind={lane.pathologies[0] ?? 'calm'} hue={HUE[lane.rung]} />
                <span>{lane.handle}</span>
                <span className="why">
                  {lane.pathologies.map((p) => PATHOLOGY_WORD[p]).join(' + ')}
                  {lane.waitingInferred ? '?' : ''}
                </span>
                <span className="dur">{formatDuration(lane.sinceMs)}</span>
              </button>
            ))}
            {collisions > 0 && (
              <span
                className="att-chip num"
                style={{ ['--chip-hue' as string]: HUE.notice, cursor: 'default' }}
                title={`${fleet.evidence.collisionPairs} branch pairs contend over ${collisions} files`}
              >
                <span>{collisions}</span>
                <span className="why">contended files</span>
                <span className="dur">{fleet.evidence.collisionPairs} pairs</span>
              </span>
            )}
          </div>
        )}
      </div>

      <BurnStrip fleet={fleet} />
    </div>
  )
}

/**
 * Three words for four rungs — NOTICE covers the middle. ALL CLEAR is only ever
 * printed when the ladder is genuinely at CALM, which (see `buildFleet`) it
 * cannot be while a collision is standing.
 */
function verdict(fleet: Fleet): string {
  if (fleet.attention.length > 0) {
    return `${fleet.attention.length} NEED${fleet.attention.length === 1 ? 'S' : ''} YOU`
  }
  return fleet.rung === 'calm' ? 'ALL CLEAR' : 'NOTICE'
}

/** Ruling 14: never bare reassurance — say what was checked. */
function evidenceLine(fleet: Fleet): string {
  const e = fleet.evidence
  return [
    `${e.laneCount} lanes`,
    `${e.fencedLaneCount}/${e.laneCount} on fence`,
    `collisions 0 — checked ${e.branchesChecked} branches / ${e.filesChecked} files`,
    `newest event ${formatAge(e.newestEventAgeMs)} ago`,
  ].join('  ·  ')
}

function leadPathology(fleet: Fleet): Pathology | 'calm' {
  return fleet.attention[0]?.pathologies[0] ?? 'calm'
}

/** Fires exactly once per new attention item, then holds steady (law 10). */
function usePulse(count: number): boolean {
  const previous = useRef(count)
  const [pulsing, setPulsing] = useState(false)

  useEffect(() => {
    if (count > previous.current) {
      setPulsing(true)
      const timer = setTimeout(() => setPulsing(false), 950)
      previous.current = count
      return () => clearTimeout(timer)
    }
    previous.current = count
    return undefined
  }, [count])

  return pulsing
}

// ── burn strip: four numbers, no chrome ─────────────────────────────────────

export function BurnStrip({ fleet }: { fleet: Fleet }): ReactElement {
  const { burn } = fleet
  const dollars = burn.costAuthoritative === true

  return (
    <div className="burn">
      <Cell
        value={formatTokens(burn.outputTokens)}
        unit="output tok"
        title={`session output tokens across ${fleet.lanes.length} lanes`}
      />
      <Cell
        value={dollars ? formatUsd(burn.costUsd) : '—'}
        unit={dollars ? 'authoritative' : 'no cost feed'}
        muted={!dollars}
        title={
          burn.costEventCount === 0
            ? 'no llm.cost events — dollars unavailable'
            : 'estimated dollars, not the CLI’s own number'
        }
      />
      <Cell
        value={dollars ? `${formatUsd(burn.costPerHour)}` : formatRate(burn.outputPerMin)}
        unit={dollars ? 'per hour' : 'out tok/min'}
        title="trailing 5-minute window"
      />
      <Cell
        value={formatRatio(burn.overheadRatio)}
        unit="cond ÷ work"
        muted={burn.overheadRatio === null}
        title={
          burn.conductorInstrumented
            ? 'conductor output tokens ÷ worker output tokens'
            : 'conductor not instrumented — ratio unknowable'
        }
      />
    </div>
  )
}

function Cell({
  value,
  unit,
  muted = false,
  title,
}: {
  value: string
  unit: string
  muted?: boolean
  title?: string
}): ReactElement {
  return (
    <div className="burn-cell" title={title}>
      <span className={muted ? 'burn-v muted' : 'burn-v'}>{value}</span>
      <span className="burn-u">{unit}</span>
    </div>
  )
}

// ── fleet table ─────────────────────────────────────────────────────────────

const COLUMNS: { key: string; label: string; left?: boolean; width?: number }[] = [
  { key: 'sig', label: '', left: true, width: 22 },
  { key: 'lane', label: 'lane', left: true },
  { key: 'state', label: 'state', left: true, width: 80 },
  { key: 'out', label: 'output', width: 52 },
  { key: 'bar', label: '', width: 48 },
  { key: 'rate', label: 'out/min', width: 50 },
  { key: 'cost', label: '$', width: 58 },
  { key: 'sub', label: 'sub', width: 28 },
  { key: 'ahd', label: 'ahd', width: 28 },
  { key: 'drt', label: 'drt', width: 28 },
  { key: 'fnc', label: 'fence', width: 42 },
  { key: 'age', label: 'age', width: 50 },
]

export function FleetTable({
  fleet,
  hoveredId,
  focusId,
  onHover,
}: {
  fleet: Fleet
  hoveredId: string | null
  focusId: string | null
  onHover: (id: string | null) => void
}): ReactElement {
  const maxOutput = Math.max(1, ...fleet.lanes.map((lane) => lane.outputTokens))
  const rows = fleet.main === null ? fleet.lanes : [...fleet.lanes, fleet.main]

  return (
    <div className="fleet-scroll">
      <table className="fleet">
        <colgroup>
          {COLUMNS.map((column) => (
            <col key={column.key} style={column.width ? { width: column.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th key={column.key} className={column.left ? 'l' : undefined}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((lane) => (
            <Row
              key={lane.id}
              lane={lane}
              maxOutput={maxOutput}
              hovered={hoveredId === lane.id}
              focused={focusId === lane.id}
              onHover={onHover}
            />
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="l" colSpan={COLUMNS.length} style={{ color: 'var(--ink-dim)' }}>
                no lanes yet — waiting for the git collector
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function Row({
  lane,
  maxOutput,
  hovered,
  focused,
  onHover,
}: {
  lane: LaneVital
  maxOutput: number
  hovered: boolean
  focused: boolean
  onHover: (id: string | null) => void
}): ReactElement {
  const ref = useRef<HTMLTableRowElement>(null)
  const hue = HUE[lane.rung]
  const glyph: Pathology | 'calm' = lane.pathologies[0] ?? 'calm'

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focused])

  return (
    <tr
      ref={ref}
      data-rung={lane.rung}
      style={{
        ['--rung' as string]: lane.rung === 'calm' ? 'transparent' : hue,
        background: hovered || focused ? 'var(--sf-raise)' : undefined,
        outline: focused ? `1px solid ${hue}` : undefined,
      }}
      onMouseEnter={() => onHover(lane.id)}
      onMouseLeave={() => onHover(null)}
    >
      <td className="l">
        <MiniSigil kind={glyph} hue={lane.rung === 'calm' ? 'var(--ink-dim)' : hue} />
      </td>
      <td className="l lane" title={lane.worktreePath ?? lane.handle}>
        {lane.isMain ? '◆ ' : ''}
        {lane.handle}
      </td>
      <td className="state" style={{ ['--rung' as string]: lane.rung === 'calm' ? 'var(--ink-lo)' : hue }}>
        {stateWord(lane)}
      </td>
      <td className={lane.outputTokens === 0 ? 'zero out' : 'out'} title={lane.outputTokens > 0 ? formatTokenBreakdown({ input: 0, output: lane.outputTokens, cacheRead: 0, cacheCreation: 0, total: lane.totalTokens }) : undefined}>
        {lane.outputTokens === 0 ? '·' : formatTokens(lane.outputTokens)}
      </td>
      <td>
        <span
          className="outbar"
          style={{ width: `${Math.max(1, Math.round((lane.outputTokens / maxOutput) * 46))}px` }}
        />
      </td>
      <td className={lane.outputPerMin < 1 ? 'zero' : undefined}>
        {lane.outputPerMin < 1 ? '·' : formatRate(lane.outputPerMin)}
      </td>
      <td className={lane.costUsd === 0 ? 'zero' : undefined}>
        {lane.costAuthoritative === null ? '·' : formatUsd(lane.costUsd)}
      </td>
      <td className={lane.subagentCount === 0 ? 'zero' : undefined}>
        {lane.subagentCount === 0 ? '·' : lane.subagentCount}
      </td>
      <td className={lane.aheadOfMain === 0 ? 'zero' : undefined}>
        {lane.aheadOfMain === 0 ? '·' : lane.aheadOfMain}
      </td>
      <td className={lane.dirtyFiles === 0 ? 'zero' : undefined}>
        {lane.dirtyFiles === 0 ? '·' : lane.dirtyFiles}
      </td>
      <td
        className={lane.fence === null ? 'zero' : undefined}
        style={lane.offFenceFiles.length > 0 ? { color: HUE.broken } : undefined}
        title={lane.offFenceFiles.slice(0, 6).join('\n')}
      >
        {lane.fence === null ? 'none' : lane.offFenceFiles.length === 0 ? 'ok' : `+${lane.offFenceFiles.length}`}
      </td>
      <td style={lane.pathologies.includes('frozen') ? { color: HUE.broken } : undefined}>
        {formatAge(lane.ageMs)}
      </td>
    </tr>
  )
}

/**
 * The worst thing wrong with this lane, plus a count of the rest. The column is
 * a *scan* target — a row that spells out `LOOPING+EXPENSIVE` widens the table
 * and slows every other row's read for one lane's benefit.
 */
function stateWord(lane: LaneVital): string {
  if (lane.pathologies.length > 0) {
    const worst = [...lane.pathologies].sort(
      (a, b) => RUNG_ORDER[PATHOLOGY_RUNG[b]] - RUNG_ORDER[PATHOLOGY_RUNG[a]],
    )[0] as Pathology
    const rest = lane.pathologies.length - 1
    return rest === 0 ? PATHOLOGY_WORD[worst] : `${PATHOLOGY_WORD[worst]} +${rest}`
  }
  if (lane.agentStatus === 'done') return 'DONE'
  if (lane.isMain) return 'MAIN'
  if (lane.freshness > 0.5) return 'WORKING'
  if (lane.freshness > 0) return 'QUIET'
  return 'IDLE'
}

// ── provenance footer + gap voice (law 12) ──────────────────────────────────

export function Footer({
  fleet,
  status,
  hovered,
}: {
  fleet: Fleet
  status: string
  hovered: LaneVital | null
}): ReactElement {
  return (
    <div className="foot">
      <span className="wordmark">observatory</span>
      <span className="sep">│</span>
      <span>{fleet.repoName ?? '—'}</span>
      <span className="sep">│</span>
      <span>{status}</span>
      <span className="sep">│</span>
      <span>{fleet.evidence.eventCount.toLocaleString()} events</span>
      {hovered !== null && (
        <>
          <span className="sep">│</span>
          <span style={{ color: 'var(--ink-mid)' }}>
            {hovered.handle} — {formatTokens(hovered.outputTokens)} out · {hovered.commits} commits
            {hovered.reason === null ? '' : ` · ${hovered.reason}`}
          </span>
        </>
      )}
      <span style={{ flex: 1 }} />
      {fleet.gaps.slice(0, 2).map((gap) => (
        <GapLine key={gap.what} gap={gap} />
      ))}
    </div>
  )
}

function GapLine({ gap }: { gap: Gap }): ReactElement {
  return (
    <span className="gap">
      <b>{gap.what}</b> — {gap.why} — run: <code>{gap.fix}</code>
    </span>
  )
}
