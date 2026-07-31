/**
 * The scene's ink, under prd3's colour law (ruling 9).
 *
 * Status owns hue. The ladder's four hues appear nowhere else, and identity —
 * which lane, how big, how fresh — differentiates by *lightness*, shape and
 * position only. That is why the whole network is bone-grey and the pulses are
 * colourless light: a commit running home is an event, not a status, so it may
 * be bright but it may not be blue.
 *
 * "White-hot" for an expensive lane is therefore legal and deliberate: it is
 * lightness pushed to its ceiling, not a fifth hue.
 */

export const VOID = '#05060a'
export const VOID_RAISED = '#0b0d15'
export const LINE = '#1a1e2e'

/** The mycelium itself. Neutral by construction — hue is not ours to spend. */
export const BONE = [206, 214, 228] as const
/** Deep bone, for a thread whose lane has gone cold. */
export const BONE_DIM = [92, 102, 122] as const

/** Ladder hues. Exclusive. */
export const NOTICE = [77, 234, 255] as const // cyan
export const NEEDS_YOU = [255, 200, 87] as const // amber
export const BROKEN = [255, 61, 104] as const // magenta-red

export type Rgb = readonly [number, number, number]

export function rgba(color: Rgb, alpha: number): string {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${clamp01(alpha).toFixed(3)})`
}

/** Toward white — how a thread runs hot without acquiring a hue. */
export function hotter(color: Rgb, amount: number): Rgb {
  const t = clamp01(amount)
  return [
    Math.round(color[0] + (255 - color[0]) * t),
    Math.round(color[1] + (255 - color[1]) * t),
    Math.round(color[2] + (255 - color[2]) * t),
  ]
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp01(t)
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ]
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/** The CSS variable names the HTML chrome uses, kept in step with the above. */
export const CSS_TOKENS = {
  '--void': VOID,
  '--void-raised': VOID_RAISED,
  '--line': LINE,
  '--bone': `rgb(${BONE.join(', ')})`,
  '--bone-dim': `rgb(${BONE_DIM.join(', ')})`,
  '--notice': `rgb(${NOTICE.join(', ')})`,
  '--needs-you': `rgb(${NEEDS_YOU.join(', ')})`,
  '--broken': `rgb(${BROKEN.join(', ')})`,
} as const
