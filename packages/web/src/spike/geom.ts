/**
 * SPIKE A — the stroke engine.
 *
 * Cyber-sigilism (ruling 23) needs strokes that *taper* and terminate in a
 * thorn curl. SVG strokes are uniform-width, so every sigil here is a filled
 * polygon built from a centre-line plus a width ramp. One helper, one
 * vocabulary: every mark in the scene is `taper(centreline, w0, w1)`.
 */

export interface Pt {
  x: number
  y: number
}

export function polar(cx: number, cy: number, r: number, angle: number): Pt {
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
}

/** Slot angle for lane `i` of `n`: twelve o'clock, then clockwise. */
export function slotAngle(index: number, count: number): number {
  return -Math.PI / 2 + (index / Math.max(count, 1)) * Math.PI * 2
}

export function fmt(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0'
}

/**
 * A tapered ribbon along `points`, `w0` wide at the head and `w1` at the tail.
 * `ease` shapes the ramp — the default is quadratic, which keeps a stroke
 * confident for most of its length and then lets go quickly, the shape that
 * reads as "drawn with a nib".
 */
export function taper(
  points: readonly Pt[],
  w0: number,
  w1: number,
  ease: (t: number) => number = (t) => t * t,
): string {
  if (points.length < 2) return ''

  const left: Pt[] = []
  const right: Pt[] = []

  for (let i = 0; i < points.length; i += 1) {
    const previous = points[Math.max(0, i - 1)] as Pt
    const next = points[Math.min(points.length - 1, i + 1)] as Pt
    const dx = next.x - previous.x
    const dy = next.y - previous.y
    const length = Math.hypot(dx, dy) || 1
    const nx = -dy / length
    const ny = dx / length
    const t = i / (points.length - 1)
    const half = (w0 + (w1 - w0) * ease(t)) / 2
    const p = points[i] as Pt
    left.push({ x: p.x + nx * half, y: p.y + ny * half })
    right.push({ x: p.x - nx * half, y: p.y - ny * half })
  }

  const head = left.map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(p.x)} ${fmt(p.y)}`).join('')
  const tail = right
    .slice()
    .reverse()
    .map((p) => `L${fmt(p.x)} ${fmt(p.y)}`)
    .join('')
  return `${head}${tail}Z`
}

/** Sampled arc / spiral centre-line: radius and angle both interpolate. */
export function spiral(
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
  steps = 48,
): Pt[] {
  const points: Pt[] = []
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    points.push(polar(cx, cy, r0 + (r1 - r0) * t, a0 + (a1 - a0) * t))
  }
  return points
}

/** Straight centre-line, sampled so `taper` has something to ramp along. */
export function segment(from: Pt, to: Pt, steps = 12): Pt[] {
  const points: Pt[] = []
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    points.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t })
  }
  return points
}

/** Plain (untapered) polyline, for hairlines that must stay hairline. */
export function line(points: readonly Pt[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(p.x)} ${fmt(p.y)}`).join('')
}

export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const from = polar(cx, cy, r, a0)
  const to = polar(cx, cy, r, a1)
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0
  const sweep = a1 > a0 ? 1 : 0
  return `M${fmt(from.x)} ${fmt(from.y)}A${fmt(r)} ${fmt(r)} 0 ${large} ${sweep} ${fmt(to.x)} ${fmt(to.y)}`
}

/** A regular polygon, for the core. */
export function polygon(cx: number, cy: number, r: number, sides: number, rotate = 0): string {
  const points: Pt[] = []
  for (let i = 0; i < sides; i += 1) {
    points.push(polar(cx, cy, r, rotate + (i / sides) * Math.PI * 2))
  }
  return `${line(points)}Z`
}

/** Deterministic 0..1 from a string — identity lightness, breathing phase. */
export function hash01(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}

export function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value
}
