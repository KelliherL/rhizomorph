export { formatTokenBreakdown, formatTokens, formatUsd } from '../lib/format.js'

/** `9s` · `4m12s` · `1h04m` — always two significant units, never more. */
export function formatAge(ms: number | null): string {
  if (ms === null) return '—'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h${String(minutes % 60).padStart(2, '0')}m`
}

/** The attention strip's duration: coarse on purpose — `4m`, not `4m12s`. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return ''
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return `${Math.round(ms / 1000)}s`
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`
}

export function formatRatio(ratio: number | null): string {
  return ratio === null ? '—' : `×${ratio.toFixed(2)}`
}

/** `2.4K` per minute, the rate a token feed can always report. */
export function formatRate(perMinute: number): string {
  if (perMinute >= 1000) return `${(perMinute / 1000).toFixed(1)}K`
  return String(Math.round(perMinute))
}
