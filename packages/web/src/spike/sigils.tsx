import type { ReactElement } from 'react'
import { arcPath, line, polar, segment, spiral, taper, type Pt } from './geom.js'
import type { Pathology } from './fleet.js'

/**
 * SPIKE A — the sigil vocabulary.
 *
 * Ruling 23: "a lane's sigil IS its state glyph". Each of the five pathologies
 * gets a mark built from tapered strokes with thorn-curl terminals, chosen so
 * the five are separated on *form* before colour ever arrives (law 9: colour is
 * never the sole carrier):
 *
 *   LOOPING    a coil that bites its own tail — a visible cycle
 *   FROZEN     hollow ring, HORIZONTAL flatline bar, no fill
 *   WAITING    a VERTICAL arm raised out of a fully-lit bead
 *   EXPENSIVE  a radiant corona, white-hot core
 *   OFF-FENCE  a spear that has crossed the fence, bead outside the ring
 *
 * FROZEN and WAITING are the pair the brief says must not resemble each other,
 * so they are made opposite on every channel at once: axis (horizontal vs
 * vertical), fill (hollow vs solid), lightness (dimmest vs brightest thing on
 * screen), and connection (severed spoke vs live spoke).
 */

export interface MarkProps {
  cx: number
  cy: number
  /** Bead radius. Every mark scales off this so a big lane gets a big sigil. */
  r: number
  hue: string
}

/** LOOPING — a coil of 1.3 turns with a thorn-curl terminal biting inward. */
export function LoopMark({ cx, cy, r, hue }: MarkProps): ReactElement {
  // A wide radial travel is the whole point: the stroke has to visibly pass
  // *inside* where it started, or it reads as a ring rather than a cycle.
  const inner = r + 6
  const outer = r + 17
  const start = -Math.PI * 0.45
  const coil = spiral(cx, cy, outer, inner, start, start + Math.PI * 2.75, 96)
  // the terminal keeps curling inward — the tail that bites the body
  const curl = spiral(
    cx,
    cy,
    inner,
    r + 1,
    start + Math.PI * 2.75,
    start + Math.PI * 3.2,
    20,
  )
  return (
    <g>
      <path d={taper([...coil, ...curl], 3.6, 0.5)} fill={hue} opacity={0.95} />
      {/* the head of the cycle: where it started, so the eye finds the loop's seam */}
      <circle cx={polar(cx, cy, outer, start).x} cy={polar(cx, cy, outer, start).y} r={2.4} fill={hue} />
    </g>
  )
}

/** FROZEN — hollow, horizontal, severed. The flatline made a glyph. */
export function FrozenMark({ cx, cy, r, hue }: MarkProps): ReactElement {
  const reach = r * 2.1 + 6
  const bar = segment({ x: cx - reach, y: cy }, { x: cx + reach, y: cy }, 20)
  return (
    <g>
      <path d={taper(bar, 0.9, 0.9, () => 1)} fill={hue} opacity={0.9} />
      {/* end serifs — a trace that has stopped, not one that ran off the edge */}
      {[-1, 1].map((side) => (
        <path
          key={side}
          d={line([
            { x: cx + side * reach, y: cy - 3.4 },
            { x: cx + side * reach, y: cy + 3.4 },
          ])}
          stroke={hue}
          strokeWidth={1.1}
          opacity={0.75}
        />
      ))}
      {/* frost ticks: crystalline, static, cold */}
      {[-0.62, 0.62].map((side) => (
        <path
          key={side}
          d={line([
            { x: cx + side * reach * 0.55, y: cy - r * 0.5 },
            { x: cx + side * reach * 0.55, y: cy + r * 0.5 },
          ])}
          stroke={hue}
          strokeWidth={0.8}
          opacity={0.35}
        />
      ))}
    </g>
  )
}

/** WAITING — the raised hand. Vertical, bright, capped, unmistakably alive. */
export function WaitMark({ cx, cy, r, hue }: MarkProps): ReactElement {
  const height = r * 2.4 + 20
  const top = cy - r - height
  const arm: Pt[] = []
  for (let i = 0; i <= 16; i += 1) {
    const t = i / 16
    arm.push({ x: cx + Math.sin(t * Math.PI) * 1.6, y: cy - r * 0.2 - (cy - r * 0.2 - top) * t })
  }
  // base thorn — the curl that anchors the arm to the bead
  const base = spiral(cx, cy, r * 0.95, r * 1.5, Math.PI * 0.62, Math.PI * 0.18, 14)
  return (
    <g>
      <path d={taper(base, 2.6, 0.4)} fill={hue} opacity={0.8} />
      <path d={taper(arm, 4, 1.6)} fill={hue} />
      <circle cx={cx} cy={top - 1} r={3.6} fill={hue} />
      <circle cx={cx} cy={top - 1} r={7.5} fill="none" stroke={hue} strokeWidth={1.1} opacity={0.5} />
    </g>
  )
}

/** EXPENSIVE — heat. Lightness carries the temperature, hue carries the rung. */
export function HeatMark({ cx, cy, r, hue }: MarkProps): ReactElement {
  const rays = 14
  return (
    <g opacity={0.92}>
      {Array.from({ length: rays }, (_, i) => {
        const angle = (i / rays) * Math.PI * 2 - Math.PI / 2
        const long = i % 2 === 0
        const from = polar(cx, cy, r + 3, angle)
        const to = polar(cx, cy, r + 3 + (long ? r * 0.62 + 6 : r * 0.3 + 3), angle)
        return <path key={i} d={taper(segment(from, to, 6), long ? 2.8 : 1.9, 0)} fill={hue} />
      })}
    </g>
  )
}

/**
 * OFF-FENCE — the trespass. The bead has been displaced outside the fence ring
 * (position does the work); this is the spear that crossed, plus the barbs
 * where it tore through.
 */
export function TrespassMark({
  cx,
  cy,
  r,
  hue,
  from,
  angle,
}: MarkProps & { from: Pt; angle: number }): ReactElement {
  const tip = polar(cx, cy, -(r + 3), angle)
  return (
    <g>
      <path d={taper(segment(from, tip, 14), 1.2, 4.4)} fill={hue} opacity={0.95} />
      {[-1, 1].map((side) => {
        const root = polar(from.x, from.y, 0, 0)
        const barb = polar(root.x, root.y, 13, angle + side * 2.35)
        return <path key={side} d={taper(segment(root, barb, 6), 2.8, 0)} fill={hue} opacity={0.8} />
      })}
    </g>
  )
}

/** The ruptured fence: two arc ends curling away from the hole that was torn. */
export function RuptureMark({
  cx,
  cy,
  r,
  hue,
  angle,
  half,
}: {
  cx: number
  cy: number
  r: number
  hue: string
  angle: number
  half: number
}): ReactElement {
  return (
    <g>
      {[-1, 1].map((side) => {
        const edge = angle + side * half
        const curl = spiral(cx, cy, r, r + side * 0 + 15, edge, edge + side * 0.2, 14)
        return <path key={side} d={taper(curl, 2.6, 0.3)} fill={hue} opacity={0.9} />
      })}
      <path
        d={arcPath(cx, cy, r, angle - half * 2.1, angle - half)}
        fill="none"
        stroke={hue}
        strokeWidth={1.4}
        opacity={0.55}
      />
      <path
        d={arcPath(cx, cy, r, angle + half, angle + half * 2.1)}
        fill="none"
        stroke={hue}
        strokeWidth={1.4}
        opacity={0.55}
      />
    </g>
  )
}

/** Four corner ticks. The reticle that says "this one". */
export function Reticle({ cx, cy, r, hue }: MarkProps): ReactElement {
  const d = r + 13
  const arm = 7
  return (
    <g stroke={hue} strokeWidth={1.6} fill="none" opacity={0.95}>
      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sy]) => (
        <path
          key={`${sx}${sy}`}
          d={`M${cx + (sx as number) * d} ${cy + (sy as number) * (d - arm)}L${cx + (sx as number) * d} ${cy + (sy as number) * d}L${cx + (sx as number) * (d - arm)} ${cy + (sy as number) * d}`}
        />
      ))}
    </g>
  )
}

// ── the 13px table / chip glyph ─────────────────────────────────────────────

/**
 * The same five marks at row scale. This is what makes the fleet table
 * readable with the colour channel taken away — and it is deliberately the
 * *same silhouette* as the scene mark, so the table teaches the scene.
 */
export function MiniSigil({
  kind,
  hue,
  size = 13,
}: {
  kind: Pathology | 'calm'
  hue: string
  size?: number
}): ReactElement {
  const s = size
  const c = s / 2
  const common = { width: s, height: s, viewBox: `0 0 ${s} ${s}`, className: 'gsig' }

  switch (kind) {
    case 'looping':
      return (
        <svg {...common} aria-hidden>
          <path
            d={arcPath(c, c, 4, -1.1, 4.2)}
            fill="none"
            stroke={hue}
            strokeWidth={1.7}
            strokeLinecap="round"
          />
          <path d={line([polar(c, c, 4, 4.2), polar(c, c, 1.4, 5.1)])} stroke={hue} strokeWidth={1.4} />
          <circle cx={polar(c, c, 4, -1.1).x} cy={polar(c, c, 4, -1.1).y} r={1.3} fill={hue} />
        </svg>
      )
    case 'frozen':
      return (
        <svg {...common} aria-hidden>
          <circle cx={c} cy={c} r={3.3} fill="none" stroke={hue} strokeWidth={1.4} />
          <path d={`M1 ${c}H${s - 1}`} stroke={hue} strokeWidth={1.2} />
          <path d={`M1 ${c - 2}V${c + 2}M${s - 1} ${c - 2}V${c + 2}`} stroke={hue} strokeWidth={1} opacity={0.7} />
        </svg>
      )
    case 'waiting':
      return (
        <svg {...common} aria-hidden>
          <path d={`M${c} ${c + 4}V2.6`} stroke={hue} strokeWidth={1.9} strokeLinecap="round" />
          <circle cx={c} cy={1.9} r={1.6} fill={hue} />
          <circle cx={c} cy={c + 4.4} r={1.9} fill={hue} />
        </svg>
      )
    case 'expensive':
      return (
        <svg {...common} aria-hidden>
          <circle cx={c} cy={c} r={2.4} fill={hue} />
          {Array.from({ length: 8 }, (_, i) => {
            const a = (i / 8) * Math.PI * 2 - Math.PI / 2
            const f = polar(c, c, 4, a)
            const t = polar(c, c, i % 2 === 0 ? 6.2 : 5.1, a)
            return (
              <path
                key={i}
                d={line([f, t])}
                stroke={hue}
                strokeWidth={i % 2 === 0 ? 1.5 : 1}
                strokeLinecap="round"
              />
            )
          })}
        </svg>
      )
    case 'off-fence':
      return (
        <svg {...common} aria-hidden>
          <path
            d={`M4 1V${s - 1}`}
            stroke={hue}
            strokeWidth={1.2}
            strokeDasharray="2 2"
            opacity={0.8}
          />
          <path d={`M2 ${c}L${s - 2.5} ${c}`} stroke={hue} strokeWidth={1.5} strokeLinecap="round" />
          <circle cx={s - 2.6} cy={c} r={1.9} fill={hue} />
        </svg>
      )
    default:
      return (
        <svg {...common} aria-hidden>
          <circle cx={c} cy={c} r={2.1} fill={hue} opacity={0.65} />
        </svg>
      )
  }
}
