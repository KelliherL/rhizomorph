import { Fragment, useMemo, type ReactNode } from 'react'
import {
  LADDER_RANK,
  recencyOf,
  type Filament,
  type Lane,
  type Organism,
} from '../model/organism.js'
import { boundsOf, hashAngle, seedNodes, settle, type ForceNode, type SeedSpec } from './force.js'
import { coreGlyph, filamentGlyph, laneGlyph } from './glyphs.js'
import { LADDER_HUE, NECROTIC } from './palette.js'
import {
  coiledSpine,
  heatSpines,
  raisedSpine,
  ribbon,
  ring,
  shardSpines,
  sweptSpine,
  taper,
  thorn,
  trespassSpine,
  type Part,
  type Vec,
} from './sigil.js'

/**
 * The organism, drawn.
 *
 * Encodings, all of them geometric so none of them need a legend:
 *
 * - **work size** → limb base width and node radius (√ of output tokens);
 * - **recency** → luminance of the whole limb, and how many thorns it still
 *   carries: fresh growth is barbed and bright, stale growth smooths and fades;
 * - **generation** → filaments spring from the outer third of a parent limb,
 *   not from a fresh edge, so second growth reads as growth;
 * - **pathology** → what the limb *does* (coil, shatter, raise, radiate,
 *   trespass), with hue only ever saying how urgent that is.
 */

const CORE_RADIUS = 50
const LANE_MIN_R = 12
const LANE_MAX_R = 30
/**
 * Work size is a √-ish scale, but flatter than √: one runaway lane at 20× the
 * fleet must not squash every other node to the floor. 0.38 keeps a 4× spread
 * in radius across two orders of magnitude of output.
 */
const SIZE_EXPONENT = 0.38
const FIL_MIN_R = 5
const FIL_MAX_R = 12
/** Thorns are punctuation, not structure — they never scale past legibility. */
const MAX_THORN = 13

export interface SceneProps {
  organism: Organism
  selected: string | null
  onSelect: (laneId: string | null) => void
}

interface Placement {
  node: ForceNode
  lane: Lane
  filament: Filament | null
}

export function Scene({ organism, selected, onSelect }: SceneProps) {
  const field = useMemo(() => buildField(organism), [organism])
  const { bounds, byId, lanes } = field

  const alarmed = organism.lanes.some((lane) => LADDER_RANK[lane.ladder] >= 2)

  // Loudest last: an alarm is drawn over the calm field, never under it.
  const drawOrder = [...lanes].sort(
    (a, b) => LADDER_RANK[a.lane.ladder] - LADDER_RANK[b.lane.ladder] || a.lane.outputTokens - b.lane.outputTokens,
  )

  const content = (
    <>
      {drawOrder.map((placement) => (
        <Limb
          key={placement.lane.id}
          placement={placement}
          byId={byId}
          dimmed={alarmed && LADDER_RANK[placement.lane.ladder] < 2}
          selected={selected === placement.lane.id}
          onSelect={onSelect}
        />
      ))}
      <CoreMark organism={organism} />
    </>
  )

  return (
    <svg
      className="sigil-scene"
      viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`${organism.core.lanes} lanes around ${organism.mainBranch ?? 'main'}`}
      onClick={() => onSelect(null)}
    >
      <defs>
        <filter id="sigil-bloom" x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>
      {/* Two passes of the same marks: a blurred bloom beneath, crisp ink over.
          The glow is the same handwriting out of focus, never a separate shape. */}
      <g className="sigil-bloom" filter="url(#sigil-bloom)" aria-hidden="true">
        {content}
      </g>
      <g className="sigil-ink">{content}</g>
    </svg>
  )
}

// --- the field -------------------------------------------------------------------

interface Field {
  bounds: ReturnType<typeof boundsOf>
  byId: Map<string, ForceNode>
  lanes: Placement[]
}

function buildField(organism: Organism): Field {
  const maxOutput = Math.max(1, ...organism.lanes.map((lane) => lane.outputTokens))
  const maxFilament = Math.max(
    1,
    ...organism.lanes.flatMap((lane) => lane.filaments.map((f) => f.outputTokens)),
  )

  const specs: SeedSpec[] = [
    { id: '@core', generation: 0, parent: null, radius: CORE_RADIUS, linkDistance: 0, mass: 40 },
  ]
  const placements: Placement[] = []

  for (const lane of organism.lanes) {
    const radius = scaleRadius(lane.outputTokens, maxOutput, LANE_MIN_R, LANE_MAX_R)
    specs.push({
      id: lane.id,
      generation: 1,
      parent: '@core',
      radius,
      // Limb length is deliberately *not* an encoding — it is varied by a hash
      // so the field grows unevenly, the way a thing that grew does, instead of
      // radiating like a wheel. Size and recency carry the meaning.
      linkDistance:
        132 + hashAngle(`${lane.id}:len`) * 130 + radius * 1.5 + (lane.filaments.length > 0 ? 40 : 0),
      mass: 1 + radius / 14,
      // Off-fence: drawn bodily toward the lane it is trespassing on.
      ...(lane.trespassInto === null ? {} : { pull: { to: lane.trespassInto, strength: 0.019 } }),
    })
    for (const filament of lane.filaments) {
      const filRadius = scaleRadius(filament.outputTokens, maxFilament, FIL_MIN_R, FIL_MAX_R)
      specs.push({
        id: filament.id,
        generation: 2,
        parent: lane.id,
        radius: filRadius,
        linkDistance: radius + filRadius + 44,
        mass: 0.6,
      })
    }
  }

  const nodes = settle(seedNodes(specs))
  const byId = new Map(nodes.map((node) => [node.id, node]))

  for (const lane of organism.lanes) {
    const node = byId.get(lane.id)
    if (node === undefined) continue
    placements.push({ node, lane, filament: null })
  }

  return { bounds: boundsOf(nodes, 46), byId, lanes: placements }
}

function scaleRadius(value: number, max: number, min: number, cap: number): number {
  return min + (cap - min) * Math.pow(Math.max(0, value) / max, SIZE_EXPONENT)
}

// --- one lane, limb and all ----------------------------------------------------

interface LimbProps {
  placement: Placement
  byId: Map<string, ForceNode>
  dimmed: boolean
  selected: boolean
  onSelect: (laneId: string) => void
}

function Limb({ placement, byId, dimmed, selected, onSelect }: LimbProps) {
  const { lane, node } = placement
  const core = byId.get('@core')
  if (core === undefined) return null

  const hue = lane.retired ? LADDER_HUE.calm : LADDER_HUE[lane.ladder]
  const stale = recencyOf(lane)
  // Recency is luminance: 1.0 fresh → 0.36 long-silent. Salience dimming rides
  // on top of it, and it only really bites on the calm field — a NOTICE lane
  // stays legible next to an alarm, it just stops competing with it.
  const alarm = LADDER_RANK[lane.ladder] >= 2 && !lane.retired
  const salience = dimmed ? (lane.ladder === 'notice' ? 0.75 : 0.7) : 1
  // An alarm never fades and is never dimmed. FROZEN is old *by definition*, so
  // letting the recency ramp reach it would hide the loudest thing on the page.
  const life = alarm ? 1 : (1 - stale * 0.58) * salience * (lane.retired ? 0.5 : 1)

  const frozen = lane.pathologies.includes('frozen')
  const looping = lane.pathologies.includes('looping')
  const waiting = lane.pathologies.includes('waiting')
  const hot = lane.pathologies.includes('expensive')
  const offFence = lane.pathologies.includes('off-fence')

  const from = edgePoint(core, node, CORE_RADIUS - 6)
  // A raised limb meets its node from underneath; everything else meets it on
  // the side facing the core.
  const to = waiting
    ? { x: node.x, y: node.y + node.radius + 2 }
    : edgePoint(node, core, node.radius + 2)

  const bias = (hashAngle(`${lane.id}:bow`) - 0.5) * 0.78
  const baseWidth = 1.5 + (node.radius - LANE_MIN_R) * 0.3 + (hot ? 1.8 : 0)

  const target = lane.trespassInto === null ? undefined : byId.get(lane.trespassInto)
  const spine: Vec[] = offFence && target !== undefined
    ? trespassSpine(from, to, { x: target.x, y: target.y })
    : looping
      ? coiledSpine(from, to, bias)
      : waiting
        ? raisedSpine(from, to, bias)
        : sweptSpine(from, to, bias)

  const limbPaths: Part[] = []
  if (frozen) {
    // No sweep, no taper, no thorns: three brittle shards on a straight run.
    for (const shard of shardSpines(from, to)) {
      limbPaths.push({ d: ribbon(shard, [baseWidth * 0.85, baseWidth * 0.7]) })
    }
  } else {
    limbPaths.push({ d: ribbon(spine, taper(spine.length, baseWidth, hot ? 0.9 : 0.35, 1.5)) })
    // Thorns are new growth: a limb that has gone quiet loses them.
    const thornCount = Math.max(0, Math.round((1 - stale) * 4) + (hot ? 1 : 0))
    const thornLength = Math.min(baseWidth * 2.4, MAX_THORN)
    for (let index = 0; index < thornCount; index += 1) {
      const t = 0.22 + (index / Math.max(1, thornCount)) * 0.6
      limbPaths.push({
        d: thorn(spine, t, thornLength, index % 2 === 0 ? 1 : -1),
        opacity: 0.9,
      })
    }
    if (hot) {
      limbPaths.push({ d: heatSpines(spine, Math.min(baseWidth * 1.5, 9), 14), opacity: 0.95 })
    }
  }

  const limbColour = frozen ? NECROTIC : hue

  return (
    <g
      className={`limb${selected ? ' limb-selected' : ''}`}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(lane.id)
      }}
    >
      <g opacity={life}>
        <Paths parts={limbPaths} colour={limbColour} />

        {offFence && target !== undefined ? (
          <Grapple from={node} to={target} colour={hue} width={baseWidth} />
        ) : null}

        {lane.filaments.map((filament, index) => (
          <FilamentLimb
            key={filament.id}
            filament={filament}
            node={byId.get(filament.id)}
            spine={spine}
            colour={hue}
            baseWidth={baseWidth}
            index={index}
          />
        ))}

        <g transform={`translate(${node.x} ${node.y}) scale(${node.radius / 1.6})`}>
          <Paths parts={laneGlyph(lane.pathologies, lane.retired)} colour={hue} />
        </g>

        {LADDER_RANK[lane.ladder] >= 2 && !lane.retired ? (
          <Cartouche x={node.x} y={node.y} radius={node.radius * 2.05} colour={hue} />
        ) : null}
      </g>

      {selected ? (
        <circle
          className="limb-pulse"
          cx={node.x}
          cy={node.y}
          r={node.radius * 2.5}
          fill="none"
          stroke={hue}
          strokeWidth={1.4}
        />
      ) : null}

      {/* Labels sit above the recency ramp: a limb may fade, its name must not
          become unreadable — the glance test needs the name of the lane. */}
      <text
        className="node-label"
        x={node.x}
        y={node.y + node.radius + 16}
        textAnchor="middle"
        fill={hue}
        opacity={0.55 + life * 0.45}
      >
        {lane.label}
      </text>
    </g>
  )
}

/**
 * Second generation. The filament leaves the *parent limb*, three-quarters of
 * the way out, rather than the node — so a worker that deployed subagents has
 * visibly branched rather than acquired extra edges.
 */
function FilamentLimb({
  filament,
  node,
  spine,
  colour,
  baseWidth,
  index,
}: {
  filament: Filament
  node: ForceNode | undefined
  spine: readonly Vec[]
  colour: string
  baseWidth: number
  index: number
}) {
  if (node === undefined) return null
  const anchorIndex = Math.min(
    spine.length - 1,
    Math.round(spine.length * (0.7 + (index % 3) * 0.09)),
  )
  const anchor = spine[anchorIndex] as Vec
  const branch = sweptSpine(anchor, { x: node.x, y: node.y }, (hashAngle(filament.id) - 0.5) * 0.5, 18)
  const width = Math.max(1.1, baseWidth * 0.4)

  return (
    <g className="filament">
      <Paths
        parts={[
          { d: ribbon(branch, taper(branch.length, width, 0.18, 1.4)) },
          { d: thorn(branch, 0.55, width * 2.2, index % 2 === 0 ? 1 : -1), opacity: 0.8 },
        ]}
        colour={colour}
        opacity={0.95}
      />
      <g transform={`translate(${node.x} ${node.y}) scale(${node.radius / 1.35})`}>
        <Paths parts={filamentGlyph()} colour={colour} opacity={0.9} />
      </g>
    </g>
  )
}

/**
 * OFF-FENCE, said twice: the node has been dragged toward the territory it is
 * touching, and this thin barbed reach runs from it and hooks the neighbour's
 * rim. Nothing else in the field connects two lanes to each other — every other
 * line in the organism runs to the core or to its own second growth — so a
 * lane-to-lane stroke can only mean trespass.
 */
function Grapple({
  from,
  to,
  colour,
  width,
}: {
  from: ForceNode
  to: ForceNode
  colour: string
  width: number
}) {
  const start = edgePoint(from, to, from.radius + 1)
  const end = edgePoint(to, from, to.radius + 3)
  const reach = sweptSpine(start, end, 0.16, 22)
  const hookBase = reach[reach.length - 1] as Vec
  const back = reach[reach.length - 6] as Vec
  const dx = hookBase.x - back.x
  const dy = hookBase.y - back.y
  const length = Math.hypot(dx, dy) || 1
  const nx = -dy / length
  const ny = dx / length
  const claw = [
    hookBase,
    { x: hookBase.x + nx * 9 + (dx / length) * 3, y: hookBase.y + ny * 9 + (dy / length) * 3 },
    { x: hookBase.x + nx * 7 - (dx / length) * 6, y: hookBase.y + ny * 7 - (dy / length) * 6 },
  ]

  return (
    <g className="grapple">
      <Paths
        parts={[
          { d: ribbon(reach, taper(reach.length, Math.max(1.4, width * 0.5), 0.8, 0.9)) },
          { d: thorn(reach, 0.38, 9, 1) },
          { d: thorn(reach, 0.66, 9, -1) },
          { d: ribbon(claw, taper(claw.length, 2, 0, 1.1)) },
          // The breach: the neighbour's rim, ringed in the trespasser's hue.
          { d: ring({ x: to.x, y: to.y }, to.radius + 7), stroke: 1.3, opacity: 0.65 },
        ]}
        colour={colour}
      />
    </g>
  )
}

/**
 * The enclosure. Only a needs-you or broken lane is bracketed, and nothing
 * else on the page ever is — a thorned ring around one node is the single
 * loudest mark the vocabulary has.
 */
function Cartouche({ x, y, radius, colour }: { x: number; y: number; radius: number; colour: string }) {
  const barbs: Part[] = []
  for (let index = 0; index < 6; index += 1) {
    const angle = (index / 6) * Math.PI * 2 - Math.PI / 2
    const inner = radius
    const outer = radius + radius * 0.28
    barbs.push({
      d: ribbon(
        [
          { x: Math.cos(angle) * inner, y: Math.sin(angle) * inner },
          { x: Math.cos(angle) * outer, y: Math.sin(angle) * outer },
        ],
        [radius * 0.075, 0],
      ),
    })
  }
  return (
    <g className="cartouche" transform={`translate(${x} ${y})`}>
      <Paths
        parts={[{ d: ring({ x: 0, y: 0 }, radius), stroke: radius * 0.055, opacity: 0.95 }, ...barbs]}
        colour={colour}
      />
    </g>
  )
}

function CoreMark({ organism }: { organism: Organism }) {
  const parts = useMemo(() => coreGlyph(organism.core.lanes), [organism.core.lanes])
  return (
    <g className="sigil-core">
      <g className="core-breath" transform={`scale(${CORE_RADIUS})`}>
        <Paths parts={parts} colour={LADDER_HUE.calm} opacity={0.95} />
      </g>
      <text className="core-label" y={CORE_RADIUS + 30} textAnchor="middle">
        {organism.mainBranch ?? 'main'}
      </text>
    </g>
  )
}

// --- part renderer ---------------------------------------------------------------

function Paths({
  parts,
  colour,
  opacity = 1,
}: {
  parts: readonly Part[]
  colour: string
  opacity?: number
}): ReactNode {
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {part.stroke === undefined ? (
            <path d={part.d} fill={colour} opacity={(part.opacity ?? 1) * opacity} />
          ) : (
            <path
              d={part.d}
              fill="none"
              stroke={colour}
              strokeWidth={part.stroke}
              strokeLinecap={part.cap ?? 'round'}
              opacity={(part.opacity ?? 1) * opacity}
            />
          )}
        </Fragment>
      ))}
    </>
  )
}

function edgePoint(from: ForceNode, toward: ForceNode, distance: number): Vec {
  const dx = toward.x - from.x
  const dy = toward.y - from.y
  const length = Math.hypot(dx, dy) || 1
  return { x: from.x + (dx / length) * distance, y: from.y + (dy / length) * distance }
}
