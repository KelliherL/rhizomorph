import { formatTokenBreakdown, formatTokens, formatUsd, formatUsdPerHour } from '../../lib/format.js'
import type { Fleet } from '../data/fleet.js'

export interface BurnStripProps {
  fleet: Fleet
}

/**
 * Ruling 13's four numbers, docked with the attention strip: output tokens,
 * dollars (when authoritative), burn rate, overhead ratio. No chrome, no panel
 * frame, no sparkline — the scene is where trend lives.
 *
 * Output leads because prd2 ruled it the headline token figure; the four-tier
 * breakdown is one hover away and never hidden. When dollars have no feed the
 * cell speaks in the gap voice instead of printing a confident `$0.00`.
 */
export function BurnStrip({ fleet }: BurnStripProps) {
  const dollars = fleet.totals.costEventCount > 0
  const authority =
    fleet.totals.costIsAuthoritative === true
      ? 'auth'
      : fleet.totals.costIsAuthoritative === false
        ? 'est'
        : null

  return (
    <div className="burn-strip">
      <Cell
        label="output"
        value={formatTokens(fleet.tokenTotals.tokens.output)}
        title={formatTokenBreakdown(fleet.tokenTotals.tokens)}
      />
      {dollars ? (
        <Cell
          label="spend"
          value={formatUsd(fleet.totals.costUsd)}
          suffix={authority}
          title={`${fleet.totals.costEventCount} cost events · ${formatUsd(
            fleet.totals.authoritativeCostUsd,
          )} authoritative`}
        />
      ) : (
        <Cell label="spend" value="—" suffix="no feed" title="no cost events recorded" muted />
      )}
      <Cell
        label="rate"
        value={dollars ? formatUsdPerHour(fleet.rate.costUsdPerHour) : `${formatTokens(Math.round(fleet.outputPerMin))}/min`}
        title={`trailing ${Math.round(fleet.rate.windowMs / 60_000)}m window`}
      />
      <Cell
        label="overhead"
        value={fleet.overheadRatio === null ? '—' : `${fleet.overheadRatio.toFixed(2)}×`}
        title="conductor output tokens ÷ worker output tokens"
        muted={fleet.overheadRatio === null}
      />
    </div>
  )
}

interface CellProps {
  label: string
  value: string
  suffix?: string | null
  title?: string
  muted?: boolean
}

function Cell({ label, value, suffix, title, muted }: CellProps) {
  return (
    <div className={`burn-cell${muted ? ' burn-muted' : ''}`} title={title}>
      <span className="burn-label">{label}</span>
      <span className="burn-value mono">{value}</span>
      {suffix ? <span className="burn-suffix">{suffix}</span> : null}
    </div>
  )
}
