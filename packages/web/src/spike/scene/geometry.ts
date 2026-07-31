import type { Fleet, Lane, PathologyKind } from '../data/fleet.js'

/**
 * Where the mycelium grows.
 *
 * Three things carry meaning in the geometry, and each is a recorded fact:
 *
 * - **distance from the root-mass = recency.** A lane that just spoke is pulled
 *   in tight; as it falls silent its node drifts out and its thread stretches.
 *   Frozen lanes end up out at the rim, which is where the eye least expects
 *   life — the dark thread and the distance say the same thing twice.
 * - **thread width = work size.** Output tokens, log-scaled against the fleet's
 *   own busiest lane, tapering root→tip like a real hypha.
 * - **angular position = identity.** Stable, alphabetical, so an operator learns
 *   where a lane lives and it does not move when the fleet's mood changes.
 *
 * Each lane also owns an angular **wedge** — its territory. That is what makes a
 * rogue filament crossing into a neighbour's wedge legible as trespass rather
 * than as decoration.
 */

export interface Point {
  x: number
  y: number
}

export interface FilamentGeometry {
  /** Where it splits off its parent thread, 0 = root, 1 = tip. */
  at: number
  path: Point[]
  width: number
  /** Finer hyphae in this bundle — encodes request volume, not distinct agents. */
  strands: Point[][]
  thread: string
}

export interface ThreadGeometry {
  laneId: string
  lane: Lane
  angle: number
  /** Sampled centreline, root → node. Everything else indexes into this. */
  path: Point[]
  node: Point
  widthRoot: number
  widthTip: number
  /** 0..1 log-scaled output tokens against the fleet's busiest lane. */
  sizeFrac: number
  /** 0..1 where 0 = spoke just now, 1 = long silent. */
  ageFrac: number
  filaments: FilamentGeometry[]
  /** For a looping lane: the knot the pulse orbits, and its radius. */
  knot: { centre: Point; radius: number; tangent: number } | null
  /** For an off-fence lane: the rogue filament and whose wedge it enters. */
  rogue: { path: Point[]; victimId: string | null } | null
  wedge: { start: number; end: number }
  label: { anchor: Point; align: 'left' | 'right' }
  /** The dominant pathology, if any — what the node's sigil draws. */
  pathology: PathologyKind | null
}

export interface SceneGeometry {
  width: number
  height: number
  centre: Point
  /** Radius of the root-mass proper. */
  rootRadius: number
  /** Ellipse the nodes sit on at full drift — the fleet's outer rim. */
  rx: number
  ry: number
  threads: ThreadGeometry[]
  byLane: Map<string, ThreadGeometry>
}

/** How long a lane must be silent to drift all the way out. */
const RECENCY_SPAN_MS = 10 * 60_000
const SAMPLES = 44
const BUNDLE_SIZE = 4

/** Priority when a lane has more than one fault: the worst sigil wins the node. */
const PATHOLOGY_PRIORITY: readonly PathologyKind[] = [
  'frozen',
  'looping',
  'waiting',
  'off-fence',
  'expensive',
]

/**
 * `now` is taken per frame rather than from the fleet snapshot: recency is a
 * continuous quantity, so a node drifting outward should glide rather than jump
 * once a second when the derived state is rebuilt.
 */
export function layoutScene(
  fleet: Fleet,
  width: number,
  height: number,
  now: number,
): SceneGeometry {
  const centre: Point = { x: width / 2, y: height / 2 }
  const rootRadius = Math.max(26, Math.min(width, height) * 0.072)

  // Labels live outside the nodes, so the ellipse has to leave them room.
  const rx = Math.max(80, width / 2 - 118)
  const ry = Math.max(60, height / 2 - 46)

  // Stable order: identity, not status. A lane must not move when it breaks.
  const lanes = [...fleet.lanes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const n = Math.max(1, lanes.length)

  const maxOutput = Math.max(1, ...lanes.map((lane) => lane.outputTokens))
  const bundleCount = Math.max(1, Math.ceil(n / BUNDLE_SIZE))

  const threads: ThreadGeometry[] = []
  const byLane = new Map<string, ThreadGeometry>()

  const angleOf = (i: number): number => -Math.PI / 2 + (2 * Math.PI * (i + 0.5)) / n
  const wedgeHalf = Math.PI / n

  lanes.forEach((lane, i) => {
    const angle = angleOf(i)
    const ageFrac =
      lane.lastEventTs === null
        ? 0.98
        : clamp01(Math.max(0, now - lane.lastEventTs) / RECENCY_SPAN_MS)
    // Fresh lanes crowd the root-mass; silent ones drift to the rim.
    const radial = 0.66 + 0.32 * easeOut(ageFrac)

    const node: Point = {
      x: centre.x + rx * radial * Math.cos(angle),
      y: centre.y + ry * radial * Math.sin(angle),
    }

    // Bundling: neighbours leave the root-mass together and fan apart, the way
    // hyphae do. Without it, twenty threads read as a starburst, not a network.
    const bundleIndex = Math.floor(i / BUNDLE_SIZE) % bundleCount
    const bundleMembers = Math.min(BUNDLE_SIZE, n - bundleIndex * BUNDLE_SIZE)
    const bundleAngle = angleOf(bundleIndex * BUNDLE_SIZE + (bundleMembers - 1) / 2)
    const bundle: Point = {
      x: centre.x + rx * 0.3 * Math.cos(bundleAngle),
      y: centre.y + ry * 0.3 * Math.sin(bundleAngle),
    }

    // The thread leaves the rim already leaning toward its bundle.
    const rimAngle = angle + angleDelta(angle, bundleAngle) * 0.62
    const rim: Point = {
      x: centre.x + rootRadius * 0.92 * Math.cos(rimAngle),
      y: centre.y + rootRadius * 0.92 * Math.sin(rimAngle),
    }

    const wander = (hash(lane.id) - 0.5) * Math.min(rx, ry) * 0.24
    const outward = { x: Math.cos(angle), y: Math.sin(angle) }
    const perp = { x: -outward.y, y: outward.x }
    const control2: Point = {
      x: bundle.x + (node.x - bundle.x) * 0.62 + perp.x * wander,
      y: bundle.y + (node.y - bundle.y) * 0.62 + perp.y * wander,
    }

    const path = sampleCubic(rim, bundle, control2, node, SAMPLES)

    const sizeFrac = clamp01(Math.log1p(lane.outputTokens) / Math.log1p(maxOutput))
    const widthRoot = 1.1 + 5.2 * sizeFrac
    const widthTip = 0.4 + 1.3 * sizeFrac

    const pathology = PATHOLOGY_PRIORITY.find((kind) =>
      lane.pathologies.some((p) => p.kind === kind),
    ) ?? null

    threads.push({
      laneId: lane.id,
      lane,
      angle,
      path,
      node,
      widthRoot,
      widthTip,
      sizeFrac,
      ageFrac,
      filaments: layoutFilaments(lane, path, widthTip, perp),
      knot:
        pathology === 'looping'
          ? knotAt(path, 0.8, 9 + 5 * sizeFrac)
          : null,
      rogue: null,
      wedge: { start: angle - wedgeHalf, end: angle + wedgeHalf },
      label: {
        anchor: {
          x: node.x + outward.x * (11 + 7 * sizeFrac),
          y: node.y + outward.y * (11 + 7 * sizeFrac),
        },
        align: Math.cos(angle) >= 0 ? 'left' : 'right',
      },
      pathology,
    })
  })

  for (const thread of threads) byLane.set(thread.laneId, thread)

  // Rogue filaments need every node placed first — a trespass reaches for the
  // lane it trespassed against, and that lane's node has to exist.
  for (const thread of threads) {
    if (thread.pathology !== 'off-fence' && !thread.lane.trespasses.length) continue
    const victimId = victimLaneId(thread.lane, byLane)
    const target =
      victimId !== null
        ? byLane.get(victimId)?.node ?? null
        : neighbourNode(thread, threads)
    if (target === null) continue
    thread.rogue = {
      path: rogueFilament(thread, target),
      victimId,
    }
  }

  return { width, height, centre, rootRadius, rx, ry, threads, byLane }
}

// --- pieces ------------------------------------------------------------------

function layoutFilaments(
  lane: Lane,
  path: readonly Point[],
  widthTip: number,
  perp: Point,
): FilamentGeometry[] {
  // The trunk *is* the main thread; only the other threads sprout filaments.
  const branching = lane.filaments.filter((f) => f.thread !== 'main')
  if (branching.length === 0) return []

  const maxOutput = Math.max(1, ...lane.filaments.map((f) => f.outputTokens))

  return branching.map((filament, i) => {
    const at = 0.56 + i * 0.13
    const origin = pointAt(path, at)
    const along = tangentAt(path, at)
    const side = i % 2 === 0 ? 1 : -1
    const share = clamp01(filament.outputTokens / maxOutput)
    const length = (26 + 34 * share) * (lane.filaments.length > 2 ? 0.85 : 1)

    // Finer hyphae in the bundle. This encodes how much subagent traffic there
    // was, NOT how many distinct subagents — the log never names them, and a
    // count of strands that pretended otherwise would be an invented number.
    const strandCount = 1 + Math.min(4, Math.floor(Math.log2(1 + filament.requestCount)))

    const tip: Point = {
      x: origin.x + along.x * length * 0.55 + perp.x * side * length * 0.8,
      y: origin.y + along.y * length * 0.55 + perp.y * side * length * 0.8,
    }
    const control: Point = {
      x: origin.x + along.x * length * 0.62 + perp.x * side * length * 0.22,
      y: origin.y + along.y * length * 0.62 + perp.y * side * length * 0.22,
    }

    const strands: Point[][] = []
    for (let s = 0; s < strandCount; s += 1) {
      const spread = (s - (strandCount - 1) / 2) * 0.34
      const strandTip: Point = {
        x: tip.x + perp.x * side * spread * length * 0.5 + along.x * spread * length * 0.4,
        y: tip.y + perp.y * side * spread * length * 0.5 + along.y * spread * length * 0.4,
      }
      strands.push(sampleQuad(origin, control, strandTip, 12))
    }

    return {
      at,
      path: sampleQuad(origin, control, tip, 14),
      width: Math.max(0.35, widthTip * (0.55 + 0.5 * share)),
      strands,
      thread: filament.thread ?? 'unknown',
    }
  })
}

/**
 * The knot: a small closed loop tied into the thread near its tip. A pulse
 * orbiting this is going nowhere, which is the whole statement.
 */
function knotAt(
  path: readonly Point[],
  at: number,
  radius: number,
): { centre: Point; radius: number; tangent: number } {
  const on = pointAt(path, at)
  const along = tangentAt(path, at)
  return {
    centre: { x: on.x + along.x * radius * 0.2, y: on.y + along.y * radius * 0.2 },
    radius,
    tangent: Math.atan2(along.y, along.x),
  }
}

/** A barbed tendril leaving the node and hooking into somebody else's territory. */
function rogueFilament(thread: ThreadGeometry, target: Point): Point[] {
  const from = thread.node
  const mid: Point = {
    x: from.x + (target.x - from.x) * 0.5,
    y: from.y + (target.y - from.y) * 0.5,
  }
  const perp = { x: -(target.y - from.y), y: target.x - from.x }
  const len = Math.hypot(perp.x, perp.y) || 1
  const bow = 0.16
  const control: Point = {
    x: mid.x + (perp.x / len) * len * bow,
    y: mid.y + (perp.y / len) * len * bow,
  }
  // Stop a little short of the victim's node: it is a reach, not an arrival.
  const stop: Point = {
    x: from.x + (target.x - from.x) * 0.93,
    y: from.y + (target.y - from.y) * 0.93,
  }
  return sampleQuad(from, control, stop, 22)
}

function victimLaneId(lane: Lane, byLane: Map<string, ThreadGeometry>): string | null {
  for (const trespass of lane.trespasses) {
    if (trespass.victim === null) continue
    for (const [id, thread] of byLane) {
      if (thread.lane.handle === trespass.victim || id === trespass.victim) return id
    }
  }
  return null
}

/** No named victim: the filament still crosses out, into the nearest wedge. */
function neighbourNode(thread: ThreadGeometry, threads: readonly ThreadGeometry[]): Point | null {
  const index = threads.indexOf(thread)
  if (index < 0 || threads.length < 2) return null
  const neighbour = threads[(index + 1) % threads.length]
  return neighbour === undefined ? null : neighbour.node
}

// --- curve maths -------------------------------------------------------------

function sampleCubic(p0: Point, p1: Point, p2: Point, p3: Point, n: number): Point[] {
  const out: Point[] = []
  for (let i = 0; i <= n; i += 1) {
    const t = i / n
    const u = 1 - t
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    })
  }
  return out
}

function sampleQuad(p0: Point, p1: Point, p2: Point, n: number): Point[] {
  const out: Point[] = []
  for (let i = 0; i <= n; i += 1) {
    const t = i / n
    const u = 1 - t
    out.push({
      x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    })
  }
  return out
}

/** Point at parameter `t` (0 = root, 1 = tip) on a sampled path. */
export function pointAt(path: readonly Point[], t: number): Point {
  if (path.length === 0) return { x: 0, y: 0 }
  const clamped = clamp01(t) * (path.length - 1)
  const i = Math.floor(clamped)
  const j = Math.min(path.length - 1, i + 1)
  const f = clamped - i
  const a = path[i] as Point
  const b = path[j] as Point
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
}

export function tangentAt(path: readonly Point[], t: number): Point {
  const a = pointAt(path, Math.max(0, t - 0.02))
  const b = pointAt(path, Math.min(1, t + 0.02))
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  return { x: dx / len, y: dy / len }
}

function angleDelta(from: number, to: number): number {
  let delta = to - from
  while (delta > Math.PI) delta -= 2 * Math.PI
  while (delta < -Math.PI) delta += 2 * Math.PI
  return delta
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t)
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/** Stable 0..1 from a string — deterministic wander, so the scene sits still. */
function hash(value: string): number {
  let h = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}
