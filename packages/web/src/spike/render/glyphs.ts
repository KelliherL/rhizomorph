import type { Pathology } from '../model/organism.js'
import { arc, dot, ribbon, ring, stroke, taper, type Part, type Vec } from './sigil.js'

/**
 * The glyph alphabet.
 *
 * Every mark is drawn in unit space (roughly −1.8 … 1.8, origin at the node's
 * centre) so the same code renders a lane's sigil at scene scale and again,
 * eight pixels tall, in the fleet table's STATE column. That reuse is the
 * legend: the table teaches the alphabet the scene is written in, and the
 * scene never needs a key of its own.
 *
 * One stem runs through all of them. What changes is what grows off it.
 */

const V = (x: number, y: number): Vec => ({ x, y })

/** The stem. Every living lane has one; it thins upward like a shoot. */
function stem(top = -1.6, bottom = 1.5): Part {
  return { d: stroke(V(0, bottom), V(0, top), 0.24, 0.02) }
}

/** A swept barb off the stem — the mark of ordinary growth. */
function shoot(y: number, side: 1 | -1, length: number): Part {
  const spine = [
    V(0, y),
    V(side * length * 0.45, y - length * 0.25),
    V(side * length * 0.85, y - length * 0.72),
    V(side * length * 0.92, y - length * 1.15),
  ]
  return { d: ribbon(spine, taper(spine.length, 0.16, 0, 1.3)) }
}

/** CALM · working. A shoot on each side and a seed at the tip. */
function markWorking(): Part[] {
  return [stem(), shoot(0.55, -1, 0.95), shoot(-0.05, 1, 0.9), { d: dot(V(0, -1.72), 0.13) }]
}

/**
 * LOOPING. A closed circuit around the stem with a thorn biting back into it —
 * the line has gone round and arrived where it started.
 */
function markLooping(): Part[] {
  const tail = [V(0.62, -0.62), V(0.95, -0.3), V(0.72, 0.05), V(0.42, -0.05)]
  return [
    stem(-1.3, 1.2),
    { d: ring(V(0, 0.05), 0.78), stroke: 0.17 },
    { d: ribbon(tail, taper(tail.length, 0.16, 0, 1.2)) },
  ]
}

/**
 * FROZEN. The stem is snapped and the flatline crosses it. Butt caps, no
 * curves, nothing tapering — the only mark in the alphabet with no life in the
 * line.
 */
function markFrozen(): Part[] {
  return [
    { d: ribbon([V(0, 1.5), V(0, 0.42)], [0.2, 0.2]) },
    { d: ribbon([V(0, -0.28), V(0, -1.5)], [0.2, 0.2]) },
    { d: `M-1.15 0.07L1.15 0.07`, stroke: 0.2, cap: 'butt' },
  ]
}

/**
 * WAITING. The mark opens upward and splays: three prongs off a raised wrist.
 * Curved, open and reaching where FROZEN is straight, closed and flat.
 */
function markWaiting(): Part[] {
  const prong = (dx: number, dy: number) => {
    const spine = [V(0, -0.32), V(dx * 0.45, dy * 0.5), V(dx * 0.9, dy * 0.92), V(dx, dy)]
    return { d: ribbon(spine, taper(spine.length, 0.15, 0, 1.25)) }
  }
  return [
    stem(-0.3, 1.5),
    prong(-0.82, -1.42),
    prong(0.04, -1.85),
    prong(0.86, -1.36),
    { d: arc(V(0, -0.3), 0.55, Math.PI, Math.PI * 2), stroke: 0.13, opacity: 0.85 },
  ]
}

/** EXPENSIVE. Radiant: eight rays off the stem's heart, no curve, all output. */
function markExpensive(): Part[] {
  const rays: Part[] = []
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2 + Math.PI / 8
    const inner = 0.42
    const outer = index % 2 === 0 ? 1.55 : 1.05
    rays.push({
      d: ribbon(
        [
          V(Math.cos(angle) * inner, Math.sin(angle) * inner),
          V(Math.cos(angle) * outer, Math.sin(angle) * outer),
        ],
        [0.17, 0],
      ),
    })
  }
  return [stem(-1.1, 1.0), ...rays, { d: dot(V(0, 0), 0.2) }]
}

/**
 * OFF-FENCE. A boundary drawn as three fence-posts, and a hooked limb reaching
 * straight through it. The only glyph whose mark leaves its own frame.
 */
function markOffFence(): Part[] {
  const hook = [V(-0.1, 0.35), V(0.5, 0.05), V(1.25, -0.3), V(1.62, -0.05), V(1.35, 0.3)]
  const posts: Part[] = [
    { d: `M0.92 -1.5L0.92 -0.85`, stroke: 0.13, cap: 'butt', opacity: 0.6 },
    { d: `M0.92 -0.5L0.92 0.15`, stroke: 0.13, cap: 'butt', opacity: 0.6 },
    { d: `M0.92 0.5L0.92 1.15`, stroke: 0.13, cap: 'butt', opacity: 0.6 },
  ]
  return [
    stem(-1.5, 1.5),
    ...posts,
    { d: ribbon(hook, taper(hook.length, 0.2, 0, 1.15)) },
  ]
}

/** Retired: the mark is sealed shut. Neutral, small, out of the conversation. */
function markRetired(): Part[] {
  return [{ d: ring(V(0, -0.15), 0.62), stroke: 0.16, opacity: 0.9 }, stem(0.45, 1.5)]
}

const MARKS: Record<Pathology, () => Part[]> = {
  looping: markLooping,
  frozen: markFrozen,
  waiting: markWaiting,
  expensive: markExpensive,
  'off-fence': markOffFence,
}

/**
 * A lane's sigil. One pathology draws its own mark; several draw all of them,
 * layered on the shared stem — a lane that is both hot and off its fence says
 * so in one glyph rather than in two badges.
 */
export function laneGlyph(pathologies: readonly Pathology[], retired: boolean): Part[] {
  if (retired) return markRetired()
  if (pathologies.length === 0) return markWorking()
  // Draw the loudest last so it sits on top.
  const order: Pathology[] = ['expensive', 'off-fence', 'looping', 'waiting', 'frozen']
  return order.filter((p) => pathologies.includes(p)).flatMap((p) => (MARKS[p] as () => Part[])())
}

/**
 * The sigil-core: main, as a glyph-heart. Concentric thorned rings with one
 * notch per lane — the core is literally made of the fleet — around a bound
 * inner mark. It is the only thing on the page that moves without an event.
 */
export function coreGlyph(laneCount: number): Part[] {
  const parts: Part[] = [
    { d: ring(V(0, 0), 1.0), stroke: 0.055, opacity: 0.55 },
    { d: arc(V(0, 0), 0.78, -2.5, 0.6), stroke: 0.075, opacity: 0.9 },
    { d: arc(V(0, 0), 0.78, 1.05, 2.65), stroke: 0.075, opacity: 0.9 },
    { d: ring(V(0, 0), 0.42), stroke: 0.05, opacity: 0.7 },
  ]

  const notches = Math.max(1, laneCount)
  for (let index = 0; index < notches; index += 1) {
    const angle = (index / notches) * Math.PI * 2 - Math.PI / 2
    const inner = 1.0
    const outer = 1.0 + (index % 3 === 0 ? 0.22 : 0.13)
    parts.push({
      d: ribbon(
        [
          V(Math.cos(angle) * inner, Math.sin(angle) * inner),
          V(Math.cos(angle) * outer, Math.sin(angle) * outer),
        ],
        [0.05, 0],
      ),
    })
  }

  // The bound inner mark: a stem crossed by two swept strokes and pinned.
  parts.push({ d: stroke(V(0, 0.62), V(0, -0.66), 0.09, 0.01) })
  const sweepLeft = [V(-0.46, 0.3), V(-0.16, 0.02), V(0.06, -0.3), V(-0.02, -0.52)]
  const sweepRight = [V(0.46, 0.3), V(0.16, 0.02), V(-0.06, -0.3), V(0.02, -0.52)]
  parts.push({ d: ribbon(sweepLeft, taper(sweepLeft.length, 0.075, 0, 1.4)) })
  parts.push({ d: ribbon(sweepRight, taper(sweepRight.length, 0.075, 0, 1.4)) })
  parts.push({ d: dot(V(0, 0.05), 0.075) })
  return parts
}

/** A filament tip's mark: the same seed the working glyph ends on, alone. */
export function filamentGlyph(): Part[] {
  return [{ d: stroke(V(0, 0.9), V(0, -0.95), 0.2, 0.02) }, { d: dot(V(0, -1.05), 0.16) }]
}
