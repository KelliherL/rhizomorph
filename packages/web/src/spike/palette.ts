/**
 * The scene needs real colour values (SVG fills are computed per element and
 * some are interpolated), so the tokens in `spike.css` are mirrored here as
 * literals. If one moves, move the other — these two files are one decision.
 */

export const HUE = {
  calm: '#7b8699',
  notice: '#45dcf2',
  needs: '#ffb347',
  broken: '#ff3d6a',
} as const

export const INK = {
  hi: '#eef1f8',
  base: '#c2cadb',
  mid: '#8c96ad',
  lo: '#5b6479',
  dim: '#3c4357',
  ghost: '#262c3b',
} as const

export const SURFACE = {
  void: '#05060a',
  panel: '#0a0c13',
  raise: '#0f121c',
  rule: '#161a26',
} as const

function channel(hex: string, at: number): number {
  return Number.parseInt(hex.slice(at, at + 2), 16)
}

/** Linear hex mix. `t = 0` → `a`, `t = 1` → `b`. */
export function mix(a: string, b: string, t: number): string {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t
  const to = (value: number) => value.toString(16).padStart(2, '0')
  const r = Math.round(channel(a, 1) + (channel(b, 1) - channel(a, 1)) * clamped)
  const g = Math.round(channel(a, 3) + (channel(b, 3) - channel(a, 3)) * clamped)
  const bl = Math.round(channel(a, 5) + (channel(b, 5) - channel(a, 5)) * clamped)
  return `#${to(r)}${to(g)}${to(bl)}`
}
