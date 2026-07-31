import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  arcPath,
  clamp,
  hash01,
  line,
  polar,
  polygon,
  segment,
  slotAngle,
  taper,
  type Pt,
} from './geom.js'
import { HUE, INK, SURFACE, mix } from './palette.js'
import {
  FrozenMark,
  HeatMark,
  LoopMark,
  Reticle,
  RuptureMark,
  TrespassMark,
  WaitMark,
} from './sigils.js'
import type { Fleet, LaneVital, Rung } from './fleet.js'

/**
 * SPIKE A — THE SCENE.
 *
 * A fixed 2D dial, not an orbiting 3D camera. That is the one structural
 * refinement in this direction and it is deliberate: ruling 1 breaks ties
 * toward glanceability, and a rotating camera means a lane is never in the
 * same place twice, is sometimes occluded, and changes apparent size with
 * perspective — three channels the encoding needs, spent on nothing.
 *
 * The channels, all of them:
 *
 *   ANGLE       lane identity. A slot is assigned at dispatch and never moves.
 *   BEAD AREA   output tokens, √-scaled — relative work size.
 *   SPOKE       recency. The wire from the core reaches the bead when the
 *               lane is live and retracts as it goes quiet; a frozen lane is
 *               visibly severed, adrift past a dark gap.
 *   FILL        recency again (lightness), plus a small per-lane identity
 *               offset. Redundant on purpose — recency is a first-second read.
 *   FENCE RING  the lane's fence. On the ring = in your lane. Outside it =
 *               trespass, and the ring is torn where the lane came through.
 *   SIGIL       the pathology, on form before colour.
 *   HUE         the ladder, and only the ladder.
 *   FILAMENTS   subagent threads, second growth off the parent bead.
 */

const VB_W = 1120
const VB_H = 900
const CX = VB_W / 2
const CY = 448
/** The fence line. Everything in its lane sits on this circle. */
const R_FENCE = 300
/** Where spokes leave the core. */
const R_HUB = 52
const CORE_R = 30
/** How far outside the fence a trespassing lane is thrown. */
const OFF_FENCE_PUSH = 48

const BEAD_MIN = 7
const BEAD_MAX = 34

export interface SceneProps {
  fleet: Fleet
  hoveredId: string | null
  onHover: (id: string | null) => void
  /** Bumped by the `L` key so the landing streak is reviewable on a frozen fixture. */
  demoLanding?: number
}

export function Scene({ fleet, hoveredId, onHover, demoLanding = 0 }: SceneProps): ReactElement {
  const lanes = useMemo(() => orderLanes(fleet.lanes), [fleet.lanes])
  const maxOutput = Math.max(1, ...lanes.map((lane) => lane.outputTokens))
  const alarmed = fleet.attention.length > 0
  const landings = useLandings(lanes, demoLanding)

  const geometry = lanes.map((lane, index) => place(lane, index, lanes.length, maxOutput))

  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} role="img" aria-label="fleet constellation">
      <defs>
        {/* Heat is hot, but EXPENSIVE is only a NOTICE — it must never out-shine
            an amber or magenta lane, so the core stops short of white. */}
        <radialGradient id="heat-core">
          <stop offset="0%" stopColor={mix('#ffffff', HUE.notice, 0.4)} />
          <stop offset="50%" stopColor={mix('#ffffff', HUE.notice, 0.85)} />
          <stop offset="100%" stopColor={mix(HUE.notice, SURFACE.void, 0.45)} />
        </radialGradient>
        {(['needs', 'broken', 'notice'] as const).map((rung) => (
          <radialGradient key={rung} id={`halo-${rung}`}>
            <stop offset="0%" stopColor={HUE[rung]} stopOpacity={rung === 'notice' ? 0.16 : 0.4} />
            <stop offset="55%" stopColor={HUE[rung]} stopOpacity={rung === 'notice' ? 0.05 : 0.13} />
            <stop offset="100%" stopColor={HUE[rung]} stopOpacity={0} />
          </radialGradient>
        ))}
        <style>{CSS}</style>
      </defs>

      <FenceRing lanes={geometry} slots={lanes.length} alarmed={alarmed} />
      <Core fleet={fleet} slots={lanes.length} />

      {geometry.map((g) => (
        <Spoke key={`s-${g.lane.id}`} g={g} alarmed={alarmed} hovered={hoveredId === g.lane.id} />
      ))}

      {landings.map((landing) => {
        const g = geometry.find((item) => item.lane.id === landing.laneId)
        if (g === undefined) return null
        return (
          <circle key={landing.key} r={3.2} fill={INK.hi}>
            <animateMotion
              dur="0.85s"
              fill="freeze"
              keyPoints="1;0"
              keyTimes="0;1"
              calcMode="spline"
              keySplines="0.2 0.8 0.3 1"
              path={line([polar(CX, CY, R_HUB, g.angle), g.at])}
            />
            <animate attributeName="opacity" values="0;1;1;0" dur="0.85s" fill="freeze" />
          </circle>
        )
      })}

      {geometry.map((g) => (
        <Bead
          key={`b-${g.lane.id}`}
          g={g}
          alarmed={alarmed}
          hovered={hoveredId === g.lane.id}
          onHover={onHover}
        />
      ))}

      {geometry.map((g) => (
        <Label key={`l-${g.lane.id}`} g={g} alarmed={alarmed} hovered={hoveredId === g.lane.id} />
      ))}
    </svg>
  )
}

// ── geometry ────────────────────────────────────────────────────────────────

interface Placed {
  lane: LaneVital
  index: number
  angle: number
  /** Half the angular width of this lane's gate on the fence ring. */
  half: number
  radius: number
  r: number
  at: Pt
  /** Where the fence line sits on this lane's spoke. */
  onFence: Pt
  hue: string
  fill: string
  offFence: boolean
}

/**
 * Slot order is *identity*, so it must not depend on anything that changes
 * minute to minute. Issue number when the lane has one, else handle.
 */
function orderLanes(lanes: LaneVital[]): LaneVital[] {
  return [...lanes].sort((a, b) => {
    const ai = a.issue === null ? Number.POSITIVE_INFINITY : Number(a.issue)
    const bi = b.issue === null ? Number.POSITIVE_INFINITY : Number(b.issue)
    return ai - bi || (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0)
  })
}

function place(lane: LaneVital, index: number, count: number, maxOutput: number): Placed {
  const angle = slotAngle(index, count)
  const half = (Math.PI / Math.max(count, 1)) * 0.62
  const r = BEAD_MIN + (BEAD_MAX - BEAD_MIN) * Math.sqrt(lane.outputTokens / maxOutput)
  const offFence = lane.pathologies.includes('off-fence')
  const radius = R_FENCE + (offFence ? OFF_FENCE_PUSH + r : 0)
  const hue = HUE[lane.rung]

  // Lightness carries recency; a small deterministic offset carries identity
  // (law 9 — identity may use lightness, never a status hue).
  const identity = (hash01(lane.id) - 0.5) * 0.1
  const lit = clamp(0.1 + lane.freshness * 0.78 + identity, 0.06, 0.95)
  const fill = lane.pathologies.includes('expensive')
    ? 'url(#heat-core)'
    : lane.rung === 'calm'
      ? mix(SURFACE.panel, INK.hi, lit)
      : mix(SURFACE.panel, hue, clamp(lit + 0.1, 0.2, 0.95))

  return {
    lane,
    index,
    angle,
    half,
    radius,
    r,
    at: polar(CX, CY, radius, angle),
    onFence: polar(CX, CY, R_FENCE, angle),
    hue,
    fill,
    offFence,
  }
}

/**
 * The contrast spend. Once anything needs the operator, everything that does
 * not steps back — this is the mechanism that makes a needs-you lane "the
 * single most salient object on screen" rather than merely a differently
 * coloured one. NOTICE steps back too: EXPENSIVE is a heads-up, not a summons.
 */
function recede(rung: Rung, alarmed: boolean, hovered: boolean): number {
  if (hovered) return 1
  if (!alarmed) return 1
  return rung === 'calm' ? 0.44 : rung === 'notice' ? 0.62 : 1
}

// ── parts ───────────────────────────────────────────────────────────────────

function FenceRing({
  lanes,
  slots,
  alarmed,
}: {
  lanes: Placed[]
  slots: number
  alarmed: boolean
}): ReactElement {
  return (
    <g>
      <circle
        cx={CX}
        cy={CY}
        r={R_FENCE}
        fill="none"
        stroke={INK.ghost}
        strokeWidth={1}
        strokeDasharray="1.5 7"
        opacity={0.9}
      />
      {lanes.map((g) =>
        g.offFence ? (
          <RuptureMark key={g.lane.id} cx={CX} cy={CY} r={R_FENCE} hue={g.hue} angle={g.angle} half={g.half} />
        ) : (
          // A lane's own stretch of the fence: solid when its dispatch declared
          // one, ghost-dashed when it did not (there is nothing to trespass).
          // Drawn in two pieces so the wire tucks behind the bead instead of
          // scoring a line across it — the bead is threaded ON the fence.
          <g key={g.lane.id} opacity={recede(g.lane.rung, alarmed, false) * 0.95}>
            {[-1, 1].map((side) => (
              <path
                key={side}
                d={arcPath(
                  CX,
                  CY,
                  R_FENCE,
                  g.angle + side * Math.min(g.half, Math.asin(g.r / R_FENCE) * 1.6),
                  g.angle + side * g.half,
                )}
                fill="none"
                stroke={g.lane.fence === null ? INK.ghost : mix(INK.dim, INK.mid, 0.45)}
                strokeWidth={g.lane.fence === null ? 1 : 2.2}
                strokeDasharray={g.lane.fence === null ? '3 4' : undefined}
                strokeLinecap="round"
              />
            ))}
          </g>
        ),
      )}
      {slots === 0 && (
        <text
          x={CX}
          y={CY + R_FENCE + 40}
          textAnchor="middle"
          fill={INK.dim}
          fontSize={12}
          style={{ fontFamily: 'var(--mono)' }}
        >
          no lanes discovered
        </text>
      )}
    </g>
  )
}

/** Main. The thing every other lane is measured against. */
function Core({ fleet, slots }: { fleet: Fleet; slots: number }): ReactElement {
  const live = (fleet.main?.freshness ?? 0) > 0.15
  return (
    <g>
      {Array.from({ length: slots }, (_, i) => {
        const a = slotAngle(i, slots)
        return (
          <path
            key={i}
            d={line([polar(CX, CY, R_HUB - 5, a), polar(CX, CY, R_HUB, a)])}
            stroke={INK.ghost}
            strokeWidth={1.4}
          />
        )
      })}
      <circle cx={CX} cy={CY} r={R_HUB} fill="none" stroke={SURFACE.rule} strokeWidth={1} />
      <g className={live ? 'breathe' : undefined} style={{ animationDelay: '0s' }}>
        <path
          d={polygon(CX, CY, CORE_R, 6, -Math.PI / 2)}
          fill={SURFACE.raise}
          stroke={HUE.notice}
          strokeWidth={1.3}
          opacity={0.9}
        />
        <path
          d={polygon(CX, CY, CORE_R * 0.48, 6, -Math.PI / 2)}
          fill="none"
          stroke={HUE.notice}
          strokeWidth={1}
          opacity={0.55}
        />
        {Array.from({ length: 6 }, (_, i) => {
          const a = -Math.PI / 2 + (i / 6) * Math.PI * 2 + Math.PI / 6
          return (
            <path
              key={i}
              d={taper(segment(polar(CX, CY, CORE_R * 0.5, a), polar(CX, CY, CORE_R * 1.32, a), 6), 2.4, 0)}
              fill={HUE.notice}
              opacity={0.45}
            />
          )
        })}
      </g>
      <text
        x={CX}
        y={CY + CORE_R + 20}
        textAnchor="middle"
        fill={INK.lo}
        fontSize={11}
        style={{ fontFamily: 'var(--mono)' }}
      >
        {fleet.mainBranch ?? 'main'}
      </text>
    </g>
  )
}

/**
 * The recency wire. Solid from the core out to `freshness` of the way there;
 * beyond that a dark gap and a dotted ghost, so a stale lane reads as
 * *drifting off the wire* rather than as merely dimmer.
 */
function Spoke({ g, alarmed, hovered }: { g: Placed; alarmed: boolean; hovered: boolean }): ReactElement {
  const inner = R_HUB
  const outer = g.radius - g.r - 2
  const reach = inner + (outer - inner) * clamp(g.lane.freshness, 0, 1)
  const opacity = recede(g.lane.rung, alarmed, hovered)
  const severed = g.lane.freshness < 0.9

  return (
    <g opacity={opacity}>
      {severed && (
        <path
          d={line([polar(CX, CY, reach, g.angle), polar(CX, CY, outer, g.angle)])}
          stroke={INK.ghost}
          strokeWidth={1.2}
          strokeDasharray="1.5 5"
          opacity={1}
        />
      )}
      {/* The wire is the RECENCY channel and nothing else — no status hue rides
          on it, or a broken lane's spoke would out-shout its own bead. */}
      <path
        d={taper(
          segment(polar(CX, CY, inner, g.angle), polar(CX, CY, reach, g.angle), 10),
          1.1,
          2.4,
          (t) => t,
        )}
        fill={mix(INK.ghost, INK.mid, g.lane.freshness)}
        opacity={0.55 + g.lane.freshness * 0.45}
      />
      {severed && (
        // the cut: a perpendicular tick where the wire stops
        <path
          d={line([
            polar(CX, CY, reach, g.angle + 0.016),
            polar(CX, CY, reach, g.angle - 0.016),
          ])}
          stroke={g.lane.pathologies.includes('frozen') ? HUE.broken : INK.dim}
          strokeWidth={2.2}
        />
      )}
    </g>
  )
}

function Bead({
  g,
  alarmed,
  hovered,
  onHover,
}: {
  g: Placed
  alarmed: boolean
  hovered: boolean
  onHover: (id: string | null) => void
}): ReactElement {
  const { lane } = g
  const frozen = lane.pathologies.includes('frozen')
  const opacity = recede(lane.rung, alarmed, hovered)
  const live = lane.freshness > 0.25 && !frozen
  const marks = { cx: g.at.x, cy: g.at.y, r: g.r, hue: g.hue }

  return (
    <g opacity={opacity}>
      {lane.rung !== 'calm' && (
        <circle
          cx={g.at.x}
          cy={g.at.y}
          r={lane.rung === 'notice' ? g.r * 2.6 : Math.max(g.r * 4.4, 64)}
          fill={`url(#halo-${lane.rung})`}
        />
      )}

      <Filaments g={g} />

      <g
        className={live ? 'breathe' : undefined}
        style={{ animationDelay: `${(hash01(lane.id) * 4).toFixed(2)}s` }}
      >
        {frozen ? (
          <circle
            cx={g.at.x}
            cy={g.at.y}
            r={g.r}
            fill={SURFACE.void}
            stroke={HUE.broken}
            strokeWidth={1.5}
            opacity={0.85}
          />
        ) : (
          <circle
            cx={g.at.x}
            cy={g.at.y}
            r={g.r}
            fill={g.fill}
            stroke={lane.rung === 'calm' ? mix(INK.ghost, INK.mid, lane.freshness) : g.hue}
            strokeWidth={lane.rung === 'calm' ? 1 : 1.6}
          />
        )}

        {lane.pathologies.includes('expensive') && <HeatMark {...marks} hue={HUE.notice} />}
        {lane.pathologies.includes('looping') && <LoopMark {...marks} hue={HUE.needs} />}
        {frozen && <FrozenMark {...marks} hue={HUE.broken} />}
        {lane.pathologies.includes('waiting') && <WaitMark {...marks} hue={HUE.needs} />}
        {g.offFence && (
          <TrespassMark {...marks} hue={HUE.broken} from={g.onFence} angle={g.angle} />
        )}
      </g>

      {(lane.rung === 'needs' || lane.rung === 'broken') && <Reticle {...marks} />}

      <circle
        cx={g.at.x}
        cy={g.at.y}
        r={Math.max(g.r + 12, 22)}
        fill="transparent"
        style={{ cursor: 'pointer' }}
        onMouseEnter={() => onHover(lane.id)}
        onMouseLeave={() => onHover(null)}
      >
        <title>{`${lane.handle} — ${lane.rung}${lane.reason === null ? '' : ` — ${lane.reason}`}`}</title>
      </circle>
    </g>
  )
}

/** Second growth: one filament per subagent thread, fanned back toward main. */
function Filaments({ g }: { g: Placed }): ReactElement | null {
  const count = Math.min(6, g.lane.subagentCount)
  if (count === 0) return null
  const share = clamp(g.lane.subagentOutputTokens / Math.max(1, g.lane.outputTokens), 0, 1)
  const reach = 10 + Math.sqrt(share) * 26

  return (
    <g opacity={0.7}>
      {Array.from({ length: count }, (_, i) => {
        const spread = ((i - (count - 1) / 2) / Math.max(count, 1)) * 1.5
        const a = g.angle + Math.PI + spread
        const from = polar(g.at.x, g.at.y, g.r * 0.7, a)
        const bend = polar(g.at.x, g.at.y, g.r + reach * 0.6, a + spread * 0.35)
        const to = polar(g.at.x, g.at.y, g.r + reach, a + spread * 0.7)
        return (
          <path
            key={i}
            d={taper([from, bend, to], 2.2, 0.2)}
            fill={g.lane.rung === 'calm' ? INK.dim : g.hue}
          />
        )
      })}
    </g>
  )
}

function Label({ g, alarmed, hovered }: { g: Placed; alarmed: boolean; hovered: boolean }): ReactElement {
  const { lane } = g
  const attention = lane.rung === 'needs' || lane.rung === 'broken'
  const stagger = g.index % 2 === 0 ? 0 : 15
  const radius = g.radius + g.r + 15 + stagger + (attention ? 8 : 0)
  const at = polar(CX, CY, radius, g.angle)
  const cos = Math.cos(g.angle)
  const anchor = cos > 0.25 ? 'start' : cos < -0.25 ? 'end' : 'middle'
  const opacity = recede(lane.rung, alarmed, hovered)

  return (
    <g opacity={opacity} style={{ pointerEvents: 'none' }}>
      <text
        x={at.x}
        y={at.y + 3}
        textAnchor={anchor}
        fill={attention ? g.hue : hovered ? INK.base : INK.lo}
        fontSize={11}
        style={{ fontFamily: 'var(--mono)', letterSpacing: '-0.02em' }}
      >
        {truncate(lane.handle, 17)}
      </text>
      {attention && lane.reason !== null && (
        <text
          x={at.x}
          y={at.y + 15}
          textAnchor={anchor}
          fill={g.hue}
          fontSize={8.5}
          opacity={0.85}
          style={{ fontFamily: 'var(--sans)', fontWeight: 700, letterSpacing: '0.1em' }}
        >
          {lane.pathologies.map((p) => p.toUpperCase()).join(' · ')}
        </text>
      )}
    </g>
  )
}

// ── landings: the one event animation (law 10) ──────────────────────────────

interface Landing {
  key: string
  laneId: string
}

/** Fires a single inbound streak per newly-observed commit, then forgets it. */
function useLandings(lanes: LaneVital[], demoLanding: number): Landing[] {
  const previous = useRef<Map<string, number>>(new Map())
  const seenDemo = useRef(demoLanding)
  const [landings, setLandings] = useState<Landing[]>([])
  const nextKey = useRef(0)

  useEffect(() => {
    const fresh: Landing[] = []
    const add = (laneId: string) => {
      nextKey.current += 1
      fresh.push({ key: `k${nextKey.current}`, laneId })
    }

    for (const lane of lanes) {
      const before = previous.current.get(lane.id)
      if (before !== undefined && lane.commits > before) add(lane.id)
      previous.current.set(lane.id, lane.commits)
    }

    if (demoLanding !== seenDemo.current) {
      seenDemo.current = demoLanding
      const busiest = [...lanes].sort((a, b) => b.freshness - a.freshness)[0]
      if (busiest !== undefined) add(busiest.id)
    }

    if (fresh.length === 0) return
    setLandings((current) => [...current, ...fresh])
    const timer = setTimeout(() => {
      setLandings((current) => current.filter((item) => !fresh.includes(item)))
    }, 900)
    return () => clearTimeout(timer)
  }, [lanes, demoLanding])

  return landings
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

const CSS = `
@keyframes breathe { 0%,100% { transform: scale(1); } 50% { transform: scale(1.022); } }
.breathe { animation: breathe 4.4s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
@media (prefers-reduced-motion: reduce) { .breathe { animation: none; } }
`
