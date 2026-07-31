import { formatTokens, formatUsd } from '../../lib/format.js'
import type { Organism } from '../model/organism.js'

/**
 * Ruling 13. Four numbers docked under the attention strip: output tokens,
 * dollars, burn rate, overhead ratio. No chrome, no sparkline, no panel frame.
 *
 * Dollars stay honest — a fleet with no `llm.cost` feed reports an em-dash and
 * the gap-voice line (ruling 12), never `$0.00`.
 */
export function BurnStrip({ organism }: { organism: Organism }) {
  const { burn } = organism

  return (
    <div className="strip burn">
      <Figure label="output" value={formatTokens(burn.outputTokens)} />
      <Figure
        label="spend"
        value={burn.costKnown ? formatUsd(burn.costUsd) : '—'}
        note={burn.costKnown && burn.costAuthoritative === false ? 'estimated' : null}
      />
      <Figure
        label="burn"
        value={
          burn.costKnown
            ? `${formatUsd(burn.costPerHour)}/hr`
            : `${formatTokens(Math.round(burn.outputPerMin))}/min`
        }
      />
      <Figure
        label="overhead"
        value={burn.overheadRatio === null ? '—' : `${burn.overheadRatio.toFixed(2)}×`}
        note={burn.overheadRatio === null ? 'no conductor telemetry' : 'conductor ÷ worker output'}
      />
      <span className="burn-spacer" />
      {burn.costGap === null ? (
        <span className="burn-provenance mono">
          {organism.eventCount.toLocaleString()} events · {organism.core.commits} commits
        </span>
      ) : (
        <span className="gap-voice mono">{burn.costGap}</span>
      )}
    </div>
  )
}

function Figure({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <div className="figure">
      <span className="figure-label">{label}</span>
      <span className="figure-value mono">{value}</span>
      {note === null || note === undefined ? null : <span className="figure-note">{note}</span>}
    </div>
  )
}
