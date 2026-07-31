import { Fragment } from 'react'
import { formatTokens, formatUsd } from '../../lib/format.js'
import { formatAge, type Lane, type Organism } from '../model/organism.js'
import { LADDER_HUE } from '../render/palette.js'
import { MiniGlyph } from './MiniGlyph.js'

/**
 * Ruling 7: dense rows, calm chrome, everything monospaced and tabular. The
 * STATE column is the scene's own glyph at 15px — read a row, learn a mark.
 *
 * Selecting a lane opens its thread sub-rows (prd2's ruling: sub-rows under the
 * parent lane, never lanes of their own) and lights the matching node.
 */
export function FleetTable({
  organism,
  selected,
  onSelect,
}: {
  organism: Organism
  selected: string | null
  onSelect: (laneId: string | null) => void
}) {
  return (
    <section className="fleet">
      <div className="fleet-head">
        <h2>FLEET</h2>
        <span className="mono fleet-count">
          {organism.core.lanes} live / {organism.lanes.length} seen
        </span>
      </div>
      <table className="fleet-table mono">
        <thead>
          <tr>
            <th className="col-state" />
            <th className="col-lane">lane</th>
            <th className="col-num">out</th>
            <th className="col-num">$</th>
            <th className="col-num">req</th>
            <th className="col-num">tool</th>
            <th className="col-num">sub</th>
            <th className="col-num">age</th>
          </tr>
        </thead>
        <tbody>
          {organism.lanes.map((lane) => (
            <Fragment key={lane.id}>
              <Row
                lane={lane}
                selected={selected === lane.id}
                onSelect={() => onSelect(selected === lane.id ? null : lane.id)}
              />
              {selected === lane.id
                ? lane.filaments.map((filament) => (
                    <tr key={filament.id} className="fleet-row fleet-subrow">
                      <td />
                      <td className="col-lane">└ {filament.label}</td>
                      <td className="col-num">{formatTokens(filament.outputTokens)}</td>
                      <td className="col-num">
                        {filament.costUsd > 0 ? formatUsd(filament.costUsd) : '—'}
                      </td>
                      <td className="col-num">{filament.requestCount}</td>
                      <td className="col-num">{filament.toolCalls}</td>
                      <td className="col-num">—</td>
                      <td className="col-num">
                        {filament.lastTs === null ? '—' : formatAge(organism.now - filament.lastTs)}
                      </td>
                    </tr>
                  ))
                : null}
              {selected === lane.id && lane.detail !== null ? (
                <tr className="fleet-row fleet-detail">
                  <td />
                  <td colSpan={7}>{lane.detail}</td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function Row({
  lane,
  selected,
  onSelect,
}: {
  lane: Lane
  selected: boolean
  onSelect: () => void
}) {
  const hue = lane.retired ? LADDER_HUE.calm : LADDER_HUE[lane.ladder]
  return (
    <tr
      className={`fleet-row${selected ? ' is-selected' : ''}${lane.retired ? ' is-retired' : ''}`}
      data-ladder={lane.ladder}
      onClick={onSelect}
    >
      <td className="col-state">
        <MiniGlyph pathologies={lane.pathologies} retired={lane.retired} colour={hue} />
      </td>
      <td className="col-lane" style={{ color: hue }}>
        {lane.label}
      </td>
      <td className="col-num">{formatTokens(lane.outputTokens)}</td>
      <td className="col-num">{lane.costKnown ? formatUsd(lane.costUsd) : '—'}</td>
      <td className="col-num">{lane.requestCount}</td>
      <td className="col-num">{lane.toolCalls}</td>
      <td className="col-num">{lane.filaments.length === 0 ? '·' : lane.filaments.length}</td>
      <td className="col-num">{lane.ageMs === null ? '—' : formatAge(lane.ageMs)}</td>
    </tr>
  )
}
