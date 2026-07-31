import { formatTokens } from '../../lib/format.js'
import type { Fleet, LadderRank, PathologyKind } from '../data/fleet.js'
import {
  pointAt,
  tangentAt,
  type Point,
  type SceneGeometry,
  type ThreadGeometry,
} from './geometry.js'
import {
  BONE,
  BONE_DIM,
  BROKEN,
  NEEDS_YOU,
  NOTICE,
  VOID,
  clamp01,
  hotter,
  mix,
  rgba,
  type Rgb,
} from './palette.js'
import { PulseField } from './pulses.js'

/**
 * Drawing the network.
 *
 * The still image is deliberately quiet: a bone-grey root-mass, bone-grey
 * threads, almost no colour. Two things break that quiet, and only two —
 * **light**, which is always an event in flight, and the **ladder hues**, which
 * only ever appear on a fault's own sigil. So an operator's eye is drawn to
 * exactly the two things worth looking at: what is moving, and what is wrong.
 *
 * Salience is settled by a spotlight rather than by competing decoration: at
 * NEEDS-YOU and above, the worst lane keeps full brightness and every other
 * thread drops back, which makes it the single most salient object by
 * construction and not by luck.
 */

export interface RenderOptions {
  ctx: CanvasRenderingContext2D
  geometry: SceneGeometry
  fleet: Fleet
  field: PulseField
  now: number
  reducedMotion: boolean
  /** The lane the spotlight is on, or null when nothing needs anyone. */
  focusId: string | null
  hoverId: string | null
}

const RANK_COLOR: Record<LadderRank, Rgb> = {
  calm: BONE,
  notice: NOTICE,
  'needs-you': NEEDS_YOU,
  broken: BROKEN,
}

const PATHOLOGY_COLOR: Record<PathologyKind, Rgb> = {
  looping: NEEDS_YOU,
  waiting: NEEDS_YOU,
  'off-fence': NEEDS_YOU,
  frozen: BROKEN,
  expensive: NOTICE,
}

/** Dim applied to everything the spotlight is not on. */
const BACKGROUND_DIM = 0.3

export function render(options: RenderOptions): void {
  const { ctx, geometry, now, reducedMotion } = options
  const { width, height } = geometry

  ctx.save()
  ctx.fillStyle = VOID
  ctx.fillRect(0, 0, width, height)

  // The one ambient motion prd3 ruling 10 allows: low-amplitude breathing.
  const breath = reducedMotion ? 1 : 1 + 0.016 * Math.sin(now / 2_600)

  drawTerritories(options)

  for (const thread of options.geometry.threads) {
    drawThread(options, thread, emphasisOf(options, thread))
  }
  for (const thread of options.geometry.threads) {
    drawFilaments(options, thread, emphasisOf(options, thread))
  }
  for (const thread of options.geometry.threads) {
    if (thread.rogue !== null) drawRogue(options, thread, emphasisOf(options, thread))
  }
  // The fence goes on last of the linework, so the rogue filament is visibly
  // *through* it rather than behind it.
  for (const thread of options.geometry.threads) {
    if (thread.rogue !== null) drawBreachedFence(options, thread)
  }

  drawRootMass(options, breath)

  ctx.globalCompositeOperation = 'lighter'
  for (const thread of options.geometry.threads) {
    drawLaneLight(options, thread, emphasisOf(options, thread))
  }
  ctx.globalCompositeOperation = 'source-over'

  for (const thread of options.geometry.threads) {
    const emphasis = emphasisOf(options, thread)
    if (thread.knot !== null) drawKnot(options, thread, emphasis)
    if (thread.pathology === 'frozen') drawSevered(options, thread, emphasis)
    drawNode(options, thread, emphasis, breath)
    if (thread.pathology === 'waiting') drawRaisedHand(options, thread, emphasis, breath)
  }

  for (const thread of options.geometry.threads) {
    drawLabel(options, thread, emphasisOf(options, thread))
  }

  ctx.restore()
}

// --- territory ---------------------------------------------------------------

/**
 * Each lane owns a slice of the rim: its fence, as geography. Faint, always —
 * this is the substrate a trespass violates, not something to read on its own.
 *
 * The breach itself is marked at the *victim's node* (see drawBreachedFence),
 * where both parties are in one glance. Lighting the victim's rim arc as well
 * would put a second amber mark for one fact in a place where nothing happened.
 */
function drawTerritories(options: RenderOptions): void {
  const { ctx, geometry, fleet } = options
  if (!fleet.hasFenceManifest) return

  for (const thread of geometry.threads) {
    const span = thread.wedge.end - thread.wedge.start
    const from = thread.wedge.start + span * 0.16
    const to = thread.wedge.end - span * 0.16

    // The rim arc — a lane's frontage on the fleet's outer boundary.
    ctx.beginPath()
    for (let i = 0; i <= 14; i += 1) {
      const point = onRim(geometry, from + ((to - from) * i) / 14, 1.03)
      if (i === 0) ctx.moveTo(point.x, point.y)
      else ctx.lineTo(point.x, point.y)
    }
    ctx.lineWidth = 1
    ctx.strokeStyle = rgba(BONE, 0.055)
    ctx.stroke()

    // Boundary posts, so the wedges read as adjacent plots rather than one ring.
    for (const angle of [thread.wedge.start, thread.wedge.end]) {
      const a = onRim(geometry, angle, 1.012)
      const b = onRim(geometry, angle, 1.05)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.lineWidth = 1
      ctx.strokeStyle = rgba(BONE, 0.075)
      ctx.stroke()
    }
  }
}

function onRim(geometry: SceneGeometry, angle: number, radial: number): Point {
  return {
    x: geometry.centre.x + geometry.rx * radial * Math.cos(angle),
    y: geometry.centre.y + geometry.ry * radial * Math.sin(angle),
  }
}

// --- threads -----------------------------------------------------------------

function emphasisOf(options: RenderOptions, thread: ThreadGeometry): number {
  if (options.hoverId === thread.laneId) return 1
  if (options.focusId === null) return 1
  return thread.laneId === options.focusId ? 1 : BACKGROUND_DIM
}

function threadInk(thread: ThreadGeometry, heat: number): { color: Rgb; alpha: number } {
  const { lane } = thread

  if (thread.pathology === 'frozen') {
    // Gone dark: still drawn (render everything, ruling 22) but barely lit.
    return { color: mix(BONE_DIM, [20, 22, 30], 0.55), alpha: 0.5 }
  }

  const freshness = 1 - thread.ageFrac
  const base = mix(BONE_DIM, BONE, freshness)

  if (thread.pathology === 'expensive') {
    // White-hot: lightness at its ceiling. Not a hue — see palette.ts.
    return { color: hotter(base, 0.95), alpha: 1 }
  }

  // Two constraints pull against each other here. The floor: ruling 22 says
  // render everything, and a thread too faint to trace back to the root-mass is
  // hinted at, not rendered. The ceiling: light in flight has to out-read the
  // thread it travels on, or the flow disappears into its own substrate — so a
  // resting thread stays well below the brightness of a pulse.
  const alpha = 0.22 + 0.32 * freshness + 0.16 * clamp01(heat / 2.5)
  return { color: base, alpha: clamp01(alpha) * (lane.activity === 'done' ? 0.78 : 1) }
}

function drawThread(options: RenderOptions, thread: ThreadGeometry, emphasis: number): void {
  const { ctx, field } = options
  const heat = field.lane(thread.laneId).heat
  const ink = threadInk(thread, heat)
  const broken = thread.pathology === 'frozen'

  // Bloom first, wide and faint; then the core. Two fills, not a shadow blur —
  // shadows on forty paths a frame is where canvas 2D falls over.
  ctx.globalCompositeOperation = 'lighter'
  fillTaper(ctx, thread.path, thread.widthRoot * 3.6, thread.widthTip * 3.6, {
    style: rgba(ink.color, ink.alpha * 0.1 * emphasis),
    broken,
  })
  ctx.globalCompositeOperation = 'source-over'
  fillTaper(ctx, thread.path, thread.widthRoot, thread.widthTip, {
    style: rgba(ink.color, ink.alpha * emphasis),
    broken,
  })

  if (thread.pathology === 'expensive') {
    // Over-exposed: a wide halo plus a blown-out core. This is the one thread on
    // the screen that should look like it is damaging the sensor.
    ctx.globalCompositeOperation = 'lighter'
    fillTaper(ctx, thread.path, thread.widthRoot * 7, thread.widthTip * 7, {
      style: rgba([255, 255, 255], 0.05 * emphasis),
      broken: false,
    })
    fillTaper(ctx, thread.path, thread.widthRoot * 0.5, thread.widthTip * 0.55, {
      style: rgba([255, 255, 255], 0.7 * emphasis),
      broken: false,
    })
    ctx.globalCompositeOperation = 'source-over'
  }

  if (options.reducedMotion) drawStaticFlowGradient(options, thread, emphasis)
}

/**
 * `prefers-reduced-motion`: the flow still has to be readable, so travelling
 * light becomes a standing brightness gradient — bright at the root-mass for
 * homeward traffic, bright at the tip for nourishment going out. Same facts,
 * same direction, no movement.
 */
function drawStaticFlowGradient(
  options: RenderOptions,
  thread: ThreadGeometry,
  emphasis: number,
): void {
  const { ctx, field } = options
  const state = field.lane(thread.laneId)
  const inbound = clamp01(state.inbound / 1.6)
  const outbound = clamp01(state.outbound / 1.6)
  if (inbound < 0.03 && outbound < 0.03) return

  const root = pointAt(thread.path, 0)
  const tip = pointAt(thread.path, 1)
  const gradient = ctx.createLinearGradient(root.x, root.y, tip.x, tip.y)
  const hot = hotter(BONE, 0.75)
  gradient.addColorStop(0, rgba(hot, 0.85 * inbound * emphasis))
  gradient.addColorStop(0.45, rgba(hot, 0.06 * Math.max(inbound, outbound) * emphasis))
  gradient.addColorStop(1, rgba(hot, 0.85 * outbound * emphasis))

  ctx.globalCompositeOperation = 'lighter'
  fillTaper(ctx, thread.path, thread.widthRoot * 0.8, thread.widthTip * 1.4, {
    style: gradient,
    broken: false,
  })
  ctx.globalCompositeOperation = 'source-over'
}

function drawFilaments(options: RenderOptions, thread: ThreadGeometry, emphasis: number): void {
  const { ctx, field } = options
  if (thread.filaments.length === 0) return
  const ink = threadInk(thread, field.lane(thread.laneId).heat)

  for (const filament of thread.filaments) {
    for (const strand of filament.strands) {
      fillTaper(ctx, strand, filament.width * 1.15, filament.width * 0.25, {
        style: rgba(ink.color, ink.alpha * 0.62 * emphasis),
        broken: false,
      })
    }
    // A thorn-curl terminal on the fattest strand: the sigilist register, and it
    // marks where second growth ends rather than letting it fade out.
    drawThornCurl(ctx, filament.path, filament.width * 2.4, rgba(ink.color, ink.alpha * 0.7 * emphasis))
  }
}

/** The rogue filament: barbed, dashed, reaching into somebody else's wedge. */
function drawRogue(options: RenderOptions, thread: ThreadGeometry, emphasis: number): void {
  const { ctx } = options
  const rogue = thread.rogue
  if (rogue === null) return

  ctx.save()
  ctx.setLineDash([6, 4])
  ctx.lineWidth = 1.6
  ctx.strokeStyle = rgba(NEEDS_YOU, 0.9 * emphasis)
  ctx.beginPath()
  rogue.path.forEach((point, i) => {
    if (i === 0) ctx.moveTo(point.x, point.y)
    else ctx.lineTo(point.x, point.y)
  })
  ctx.stroke()
  ctx.restore()

  // The barb at the far end — a hook, not an arrowhead: it grabbed something.
  const tip = rogue.path[rogue.path.length - 1] as Point
  const before = rogue.path[Math.max(0, rogue.path.length - 4)] as Point
  const angle = Math.atan2(tip.y - before.y, tip.x - before.x)
  ctx.save()
  ctx.translate(tip.x, tip.y)
  ctx.rotate(angle)
  ctx.strokeStyle = rgba(NEEDS_YOU, 0.95 * emphasis)
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(-7, 0)
  ctx.quadraticCurveTo(0, 0, 2, -5)
  ctx.moveTo(-7, 0)
  ctx.quadraticCurveTo(0, 0, 2, 5)
  ctx.stroke()
  ctx.restore()
}

/**
 * The fence the rogue filament went through: a dashed amber arc drawn around the
 * *victim's* node, facing the intruder, with posts at both ends.
 *
 * The rim wedges say a lane has territory; this says which fence was crossed and
 * whose. Drawing it at the victim rather than at the offender is the point —
 * off-fence is a two-party fact, and the picture should name both.
 */
function drawBreachedFence(options: RenderOptions, thread: ThreadGeometry): void {
  const { ctx, geometry } = options
  const victimId = thread.rogue?.victimId ?? null
  if (victimId === null) return
  const victim = geometry.byLane.get(victimId)
  if (victim === undefined) return

  const at = victim.node
  const towards = Math.atan2(thread.node.y - at.y, thread.node.x - at.x)
  const radius = 24
  const half = Math.PI * 0.42

  ctx.save()
  ctx.setLineDash([4, 3])
  ctx.lineWidth = 1.4
  ctx.strokeStyle = rgba(NEEDS_YOU, 0.65)
  ctx.beginPath()
  ctx.arc(at.x, at.y, radius, towards - half, towards + half)
  ctx.stroke()
  ctx.setLineDash([])

  for (const angle of [towards - half, towards + half]) {
    ctx.beginPath()
    ctx.moveTo(at.x + Math.cos(angle) * (radius - 4), at.y + Math.sin(angle) * (radius - 4))
    ctx.lineTo(at.x + Math.cos(angle) * (radius + 4), at.y + Math.sin(angle) * (radius + 4))
    ctx.lineWidth = 1.4
    ctx.strokeStyle = rgba(NEEDS_YOU, 0.8)
    ctx.stroke()
  }
  ctx.restore()
}

// --- the root-mass -----------------------------------------------------------

/**
 * Main: a dense tangle of curls rather than a disc, so it reads as *mass* — the
 * thing everything else is threaded to. Its glow carries the conductor's own
 * burn (prd2's point that orchestration is not free), and it surges when a
 * commit arrives, which can only happen because a packet finished its journey.
 */
function drawRootMass(options: RenderOptions, breath: number): void {
  const { ctx, geometry, field, fleet, now } = options
  const { centre, rootRadius } = geometry
  const surge = clamp01(field.surge())

  // Conductor burn as a floor under the glow: a busy orchestrator is a warm root.
  const conductorHeat = clamp01(Math.log1p(fleet.root.conductorOutputTokens) / Math.log1p(400_000))
  const intensity = 0.2 + 0.35 * conductorHeat + 0.55 * surge

  const radius = rootRadius * breath
  const glow = ctx.createRadialGradient(centre.x, centre.y, radius * 0.2, centre.x, centre.y, radius * 4.2)
  glow.addColorStop(0, rgba(hotter(BONE, 0.4), 0.3 * intensity))
  glow.addColorStop(0.35, rgba(BONE, 0.1 * intensity))
  glow.addColorStop(1, rgba(BONE, 0))
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(centre.x, centre.y, radius * 4.2, 0, Math.PI * 2)
  ctx.fill()

  // The tangle. Deterministic by index, so the root-mass has a fixed likeness.
  const curls = 54
  const golden = Math.PI * (3 - Math.sqrt(5))
  ctx.lineCap = 'round'
  for (let i = 0; i < curls; i += 1) {
    const angle = i * golden
    const spiral = 0.24 + 0.76 * Math.sqrt((i + 0.5) / curls)
    const r = radius * spiral
    const start: Point = { x: centre.x + r * Math.cos(angle), y: centre.y + r * Math.sin(angle) }
    const sweep = 0.7 + ((i * 37) % 11) / 12
    const end: Point = {
      x: centre.x + r * 1.02 * Math.cos(angle + sweep),
      y: centre.y + r * 1.02 * Math.sin(angle + sweep),
    }
    const control: Point = {
      x: centre.x + r * 1.32 * Math.cos(angle + sweep * 0.5),
      y: centre.y + r * 1.32 * Math.sin(angle + sweep * 0.5),
    }
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.quadraticCurveTo(control.x, control.y, end.x, end.y)
    ctx.lineWidth = 0.5 + 1.5 * (1 - spiral)
    ctx.strokeStyle = rgba(hotter(BONE, 0.25 + 0.5 * surge), 0.1 + 0.42 * (1 - spiral) + 0.3 * surge)
    ctx.stroke()
  }

  // Core: the point every packet is running to.
  ctx.globalCompositeOperation = 'lighter'
  paintGlow(ctx, centre, radius * (0.5 + 0.35 * surge), rgba(hotter(BONE, 0.75), 0.34 + 0.42 * surge))
  ctx.globalCompositeOperation = 'source-over'

  // Arrival ring, only while a surge is decaying.
  if (surge > 0.04 && !options.reducedMotion) {
    const ring = radius * (1.1 + (1 - surge) * 2.4)
    ctx.beginPath()
    ctx.arc(centre.x, centre.y, ring, 0, Math.PI * 2)
    ctx.lineWidth = 1.2
    ctx.strokeStyle = rgba(hotter(BONE, 0.6), 0.3 * surge)
    ctx.stroke()
  }

  // The wordmark sits inside the mass: main's branch name, mono, tabular.
  const label = fleet.root.mainBranch ?? 'main'
  ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = rgba(hotter(BONE, 0.5), 0.42)
  ctx.fillText(label.toUpperCase(), centre.x, centre.y + radius + 12)
  void now
}

// --- light in flight ---------------------------------------------------------

function drawLaneLight(options: RenderOptions, thread: ThreadGeometry, emphasis: number): void {
  const { ctx, field, now, reducedMotion } = options

  if (!reducedMotion) {
    for (const pulse of field.pulses()) {
      if (pulse.laneId !== thread.laneId) continue
      drawPulse(options, thread, pulse, emphasis)
    }
  }

  // Two state treatments live here because both are *light*, not travel.
  if (thread.pathology === 'looping' && thread.knot !== null) {
    drawOrbitingPulse(options, thread, emphasis)
  }
  if (thread.pathology === 'waiting') {
    drawHeldPulse(options, thread, emphasis, now, reducedMotion)
  }
}

function drawPulse(
  options: RenderOptions,
  thread: ThreadGeometry,
  pulse: ReturnType<PulseField['pulses']>[number],
  emphasis: number,
): void {
  const { ctx, now } = options
  const progress = PulseField.progress(pulse, now)
  if (progress <= 0) return
  const t = PulseField.position(pulse, now)

  // Fade in and out so a pulse enters and leaves rather than blinking.
  const envelope = Math.sin(Math.PI * clamp01(progress)) ** 0.6

  if (pulse.kind === 'tick') {
    // A tool call: a flick at the tip. It never travels — the work is *there*.
    const at = pointAt(thread.path, 0.94)
    const along = tangentAt(thread.path, 0.94)
    ctx.beginPath()
    ctx.moveTo(at.x - along.y * 3.4, at.y + along.x * 3.4)
    ctx.lineTo(at.x + along.y * 3.4, at.y - along.x * 3.4)
    ctx.lineWidth = 1.1
    ctx.strokeStyle = rgba(hotter(BONE, 0.7), 0.5 * envelope * emphasis)
    ctx.stroke()
    return
  }

  if (pulse.kind === 'trespass') {
    const rogue = thread.rogue
    if (rogue === null) return
    const at = pointAt(rogue.path, t)
    paintGlow(ctx, at, 3.4 * envelope, rgba(NEEDS_YOU, 0.8 * envelope * emphasis))
    return
  }

  const at = pointAt(thread.path, t)
  const size = pulse.size * (0.75 + 0.35 * envelope)
  const bright = pulse.kind === 'mote' ? 0.72 : 1

  // A commit is a packet with a tail: sharp head, tapered wake. Cyber-sigilism
  // in motion — and the tail points back the way it came, so direction reads.
  if (pulse.kind === 'commit' || pulse.kind === 'landing') {
    const tailLength = 0.05 + Math.min(0.1, pulse.weight * 0.006)
    const steps = 7
    for (let i = steps; i >= 1; i -= 1) {
      const tt = clamp01(t + (pulse.homeward ? tailLength : -tailLength) * (i / steps))
      const point = pointAt(thread.path, tt)
      const fade = (1 - i / steps) ** 1.6
      paintGlow(ctx, point, size * (0.35 + 0.5 * fade), rgba(hotter(BONE, 0.8), 0.45 * fade * envelope * emphasis))
    }
  }

  paintGlow(ctx, at, size * 2.6, rgba(hotter(BONE, 0.55), 0.16 * envelope * emphasis))
  paintGlow(ctx, at, size, rgba(hotter(BONE, 0.92), bright * envelope * emphasis))
}

/**
 * LOOPING: a pulse going round a knot in the thread, never reaching the root.
 * Its phase advances one notch per `tool.activity` — the wheel turns because the
 * agent turned it, so a loop that stops looks stopped.
 */
function drawOrbitingPulse(options: RenderOptions, thread: ThreadGeometry, emphasis: number): void {
  const { ctx, field } = options
  const knot = thread.knot
  if (knot === null) return
  const phase = field.lane(thread.laneId).orbitPhase
  const angle = knot.tangent + phase * Math.PI * 2

  // A short wake behind it, so the direction of travel is visible in one frame.
  const wake = 8
  for (let i = wake; i >= 1; i -= 1) {
    const trailing = angle - (i / wake) * 0.85
    const fade = (1 - i / wake) ** 1.5
    paintGlow(
      ctx,
      {
        x: knot.centre.x + Math.cos(trailing) * knot.radius,
        y: knot.centre.y + Math.sin(trailing) * knot.radius,
      },
      1.4 + 1.8 * fade,
      rgba(hotter(NEEDS_YOU, 0.4), 0.4 * fade * emphasis),
    )
  }

  const at: Point = {
    x: knot.centre.x + Math.cos(angle) * knot.radius,
    y: knot.centre.y + Math.sin(angle) * knot.radius,
  }
  paintGlow(ctx, at, 10, rgba(NEEDS_YOU, 0.26 * emphasis))
  paintGlow(ctx, at, 3.2, rgba(hotter(NEEDS_YOU, 0.6), 0.98 * emphasis))
}

/**
 * WAITING: a pulse held at the node, breathing in place — a raised hand. It must
 * not read as FROZEN, so the thread behind it stays lit and the pulse stays
 * bright; frozen is darkness and a severed mark, waiting is light that has
 * stopped moving.
 */
function drawHeldPulse(
  options: RenderOptions,
  thread: ThreadGeometry,
  emphasis: number,
  now: number,
  reducedMotion: boolean,
): void {
  const { ctx } = options
  const throb = reducedMotion ? 0.75 : 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(now / 620))
  const at = pointAt(thread.path, 0.9)
  paintGlow(ctx, at, 13 * throb, rgba(NEEDS_YOU, 0.16 * emphasis))
  paintGlow(ctx, at, 4.6 * (0.75 + 0.35 * throb), rgba(hotter(NEEDS_YOU, 0.5), 0.9 * emphasis))
}

// --- nodes and sigils --------------------------------------------------------

/**
 * A lane's node is its sigil, and the sigil *is* its state (ruling 23): the
 * shape says which state, the hue says which rung of the ladder, and neither is
 * load-bearing alone.
 */
function drawNode(
  options: RenderOptions,
  thread: ThreadGeometry,
  emphasis: number,
  breath: number,
): void {
  const { ctx, now, reducedMotion } = options
  const { lane } = thread
  const at = thread.node
  const along = tangentAt(thread.path, 1)
  const angle = Math.atan2(along.y, along.x)

  const length = (8 + 8 * thread.sizeFrac) * breath
  const girth = (2.8 + 4.2 * thread.sizeFrac) * breath
  const hue = thread.pathology === null ? RANK_COLOR[lane.rank] : PATHOLOGY_COLOR[thread.pathology]
  const neutral = thread.pathology === null && lane.rank === 'calm'

  ctx.save()
  ctx.translate(at.x, at.y)
  ctx.rotate(angle)

  // The lens: a sharp tapered stroke, pointed at both ends.
  ctx.beginPath()
  ctx.moveTo(-length * 0.5, 0)
  ctx.quadraticCurveTo(0, -girth, length * 0.5, 0)
  ctx.quadraticCurveTo(0, girth, -length * 0.5, 0)
  ctx.closePath()

  const freshness = 1 - thread.ageFrac
  if (thread.pathology === 'frozen') {
    ctx.strokeStyle = rgba(hue, 0.95 * emphasis)
    ctx.lineWidth = 1.3
    ctx.stroke()
  } else if (lane.activity === 'done') {
    ctx.strokeStyle = rgba(mix(BONE_DIM, BONE, 0.4), 0.7 * emphasis)
    ctx.lineWidth = 1
    ctx.stroke()
  } else if (neutral) {
    ctx.fillStyle = rgba(mix(BONE_DIM, BONE, 0.35 + 0.65 * freshness), (0.5 + 0.45 * freshness) * emphasis)
    ctx.fill()
  } else {
    ctx.fillStyle = rgba(hue, 0.9 * emphasis)
    ctx.fill()
  }

  // Thorn curl at the outer tip — every terminal in this scene ends in a hook.
  ctx.beginPath()
  ctx.moveTo(length * 0.5, 0)
  ctx.quadraticCurveTo(length * 0.5 + 5, -1.5, length * 0.5 + 3.5, -5)
  ctx.lineWidth = 1.1
  ctx.strokeStyle = rgba(
    neutral ? mix(BONE_DIM, BONE, freshness) : hue,
    (neutral ? 0.55 : 0.9) * emphasis,
  )
  ctx.stroke()

  drawStateMark(ctx, thread, hue, emphasis, length, girth, now, reducedMotion)
  ctx.restore()

  // The spotlight's halo. One object, unmistakably.
  if (options.focusId === thread.laneId) {
    const radius = length * 1.5 + 8
    ctx.beginPath()
    ctx.arc(at.x, at.y, radius, 0, Math.PI * 2)
    ctx.lineWidth = 1.4
    ctx.strokeStyle = rgba(hue, 0.75)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(at.x, at.y, radius + 5, 0, Math.PI * 2)
    ctx.lineWidth = 1
    ctx.strokeStyle = rgba(hue, 0.22)
    ctx.stroke()
  }
}

/** The glyph that names the state. Drawn in node-local space, +x = outward. */
function drawStateMark(
  ctx: CanvasRenderingContext2D,
  thread: ThreadGeometry,
  hue: Rgb,
  emphasis: number,
  length: number,
  girth: number,
  now: number,
  reducedMotion: boolean,
): void {
  const out = length * 0.5

  switch (thread.pathology) {
    // Frozen and waiting draw their marks in *world* space, not node space —
    // see drawSevered and drawRaisedHand for why.
    case 'frozen':
    case 'waiting':
      return
    case 'expensive': {
      // Rising chevrons: heat leaving the tip.
      ctx.strokeStyle = rgba(hue, 0.85 * emphasis)
      ctx.lineWidth = 1.2
      for (let i = 0; i < 3; i += 1) {
        const x = out + 4 + i * 4
        ctx.beginPath()
        ctx.moveTo(x, -5 + i)
        ctx.lineTo(x + 3.5, 0)
        ctx.lineTo(x, 5 - i)
        ctx.stroke()
      }
      return
    }
    case 'looping': {
      // A ring at the node echoes the knot on the thread: same fault, two marks.
      ctx.beginPath()
      ctx.arc(0, 0, girth + 4.5, 0, Math.PI * 2)
      ctx.lineWidth = 1.1
      ctx.strokeStyle = rgba(hue, 0.55 * emphasis)
      ctx.stroke()
      return
    }
    case 'off-fence': {
      // A barb on the node itself: this lane has a hook out.
      ctx.strokeStyle = rgba(hue, 0.9 * emphasis)
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.moveTo(-2, -girth - 2)
      ctx.quadraticCurveTo(4, -girth - 6, 9, -girth - 2)
      ctx.stroke()
      return
    }
    default: {
      if (thread.lane.activity === 'done') {
        // Sealed: a bar across the tip. Finished, not faulty.
        ctx.strokeStyle = rgba(mix(BONE_DIM, BONE, 0.5), 0.7 * emphasis)
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(out + 2, -4)
        ctx.lineTo(out + 2, 4)
        ctx.stroke()
      }
      return
    }
  }
}

/**
 * FROZEN's cut. Drawn on the thread rather than at the node, and in world space,
 * because a cut has to sit *across* the line it severs to read as one. Two
 * strokes and a gap: the thread stops here, and nothing is coming through.
 */
function drawSevered(options: RenderOptions, thread: ThreadGeometry, emphasis: number): void {
  const { ctx } = options
  const at = pointAt(thread.path, 0.74)
  const along = tangentAt(thread.path, 0.74)
  const span = 7 + thread.widthRoot

  ctx.save()
  ctx.translate(at.x, at.y)
  ctx.rotate(Math.atan2(along.y, along.x))
  ctx.strokeStyle = rgba(BROKEN, 0.95 * emphasis)
  ctx.lineWidth = 1.7
  ctx.lineCap = 'round'
  for (const offset of [-4, 4]) {
    ctx.beginPath()
    ctx.moveTo(offset - 3, -span)
    ctx.lineTo(offset + 3, span)
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * WAITING's raised hand. Also world space, and always pointing *up* the screen —
 * a hand that pointed along the thread would aim downward for half the fleet and
 * stop being a hand. This is the mark that must never be confusable with frozen,
 * so it is bright, upright, and sitting on a thread that is still lit.
 */
function drawRaisedHand(
  options: RenderOptions,
  thread: ThreadGeometry,
  emphasis: number,
  breath: number,
): void {
  const { ctx, now, reducedMotion } = options
  const at = thread.node
  const lift = (reducedMotion ? 15 : 15 + 2.6 * Math.sin(now / 620)) * breath

  ctx.save()
  // A halo behind the hand, so it carries across a busy frame at a glance.
  ctx.globalCompositeOperation = 'lighter'
  paintGlow(ctx, { x: at.x, y: at.y - 10 - lift * 0.6 }, 20, rgba(NEEDS_YOU, 0.13 * emphasis))
  ctx.globalCompositeOperation = 'source-over'

  ctx.strokeStyle = rgba(NEEDS_YOU, 0.98 * emphasis)
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(at.x, at.y - 5)
  ctx.lineTo(at.x, at.y - 5 - lift)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(at.x, at.y - 8.5 - lift, 3.4, 0, Math.PI * 2)
  ctx.fillStyle = rgba(hotter(NEEDS_YOU, 0.4), 1 * emphasis)
  ctx.fill()
  ctx.restore()
}

/** The knot itself: a closed curl tied into the thread. Amber, always visible. */
function drawKnot(options: RenderOptions, thread: ThreadGeometry, emphasis: number): void {
  const { ctx } = options
  const knot = thread.knot
  if (knot === null) return

  ctx.save()
  ctx.translate(knot.centre.x, knot.centre.y)
  ctx.rotate(knot.tangent)
  const r = knot.radius
  const width = Math.max(1.2, thread.widthRoot * 0.7)

  // The closed loop the pulse goes round. It has to be a real circuit, because
  // that circuit is the encoding — the light comes back to where it started.
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.lineWidth = width
  ctx.strokeStyle = rgba(NEEDS_YOU, 0.8 * emphasis)
  ctx.stroke()

  // Crossed tails where the thread ties into itself: the "tied" part of a knot,
  // and what stops it reading as a plain ring.
  ctx.lineCap = 'round'
  ctx.lineWidth = width * 0.9
  ctx.strokeStyle = rgba(NEEDS_YOU, 0.92 * emphasis)
  ctx.beginPath()
  ctx.moveTo(-r * 1.9, r * 0.75)
  ctx.quadraticCurveTo(-r * 0.7, r * 0.2, -r * 0.15, -r * 0.98)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(-r * 1.9, -r * 0.75)
  ctx.quadraticCurveTo(-r * 0.7, -r * 0.2, -r * 0.15, r * 0.98)
  ctx.stroke()
  ctx.restore()
}

// --- labels ------------------------------------------------------------------

function drawLabel(options: RenderOptions, thread: ThreadGeometry, emphasis: number): void {
  const { ctx, focusId } = options
  const { lane } = thread
  const focused = focusId === thread.laneId
  const hue = thread.pathology === null ? RANK_COLOR[lane.rank] : PATHOLOGY_COLOR[thread.pathology]
  const flagged = thread.pathology !== null

  const { anchor, align } = thread.label
  ctx.textAlign = align
  ctx.textBaseline = 'middle'

  // Sans for the label, per the type law — it is a name, not data.
  ctx.font = `${flagged ? 700 : 500} 10.5px ui-sans-serif, system-ui, -apple-system, sans-serif`
  const name = lane.label
  const y = anchor.y - 5

  if (focused) {
    // A chip behind the winner's name, so it survives any background.
    const width = ctx.measureText(name).width
    const left = align === 'left' ? anchor.x - 4 : anchor.x - width - 4
    ctx.fillStyle = rgba([10, 12, 18], 0.85)
    ctx.fillRect(left, y - 8, width + 8, 16)
    ctx.strokeStyle = rgba(hue, 0.5)
    ctx.lineWidth = 1
    ctx.strokeRect(left, y - 8, width + 8, 16)
  }

  ctx.fillStyle = rgba(
    flagged ? hue : mix(BONE_DIM, BONE, 1 - thread.ageFrac),
    (flagged ? 0.98 : 0.62) * (emphasis === 1 ? 1 : 0.55),
  )
  ctx.fillText(name, anchor.x, y)

  // Mono, tabular, for the number — the type law again, other side of it.
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
  ctx.fillStyle = rgba(mix(BONE_DIM, BONE, 0.45), 0.6 * (emphasis === 1 ? 1 : 0.5))
  ctx.fillText(formatTokens(lane.outputTokens), anchor.x, y + 11)
}

// --- primitives --------------------------------------------------------------

interface TaperOptions {
  /** A gradient is allowed here: the reduced-motion flow treatment needs one. */
  style: string | CanvasGradient
  /** Frozen threads are drawn with gaps: the line itself is broken. */
  broken: boolean
}

/**
 * A tapering ribbon along a sampled path, as one filled polygon. Hyphae get
 * thinner as they reach, and a constant-width stroke would lose that entirely.
 */
function fillTaper(
  ctx: CanvasRenderingContext2D,
  path: readonly Point[],
  widthRoot: number,
  widthTip: number,
  options: TaperOptions,
): void {
  if (path.length < 2) return
  const n = path.length - 1

  const runs: [number, number][] = []
  if (options.broken) {
    // Five on, two off — a dashed hairline reads as severed, not as thin.
    let start = 0
    for (let i = 0; i <= n; i += 1) {
      if (i % 7 === 5) {
        if (i - start > 1) runs.push([start, i])
        start = i + 2
      }
    }
    if (n - start > 1) runs.push([start, n])
  } else {
    runs.push([0, n])
  }

  ctx.fillStyle = options.style
  for (const [from, to] of runs) {
    ctx.beginPath()
    for (let i = from; i <= to; i += 1) {
      const t = i / n
      const half = (widthRoot + (widthTip - widthRoot) * t) / 2
      const point = path[i] as Point
      const tangent = segmentTangent(path, i)
      const x = point.x - tangent.y * half
      const y = point.y + tangent.x * half
      if (i === from) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    for (let i = to; i >= from; i -= 1) {
      const t = i / n
      const half = (widthRoot + (widthTip - widthRoot) * t) / 2
      const point = path[i] as Point
      const tangent = segmentTangent(path, i)
      ctx.lineTo(point.x + tangent.y * half, point.y - tangent.x * half)
    }
    ctx.closePath()
    ctx.fill()
  }
}

function segmentTangent(path: readonly Point[], i: number): Point {
  const a = path[Math.max(0, i - 1)] as Point
  const b = path[Math.min(path.length - 1, i + 1)] as Point
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  return { x: dx / len, y: dy / len }
}

function drawThornCurl(
  ctx: CanvasRenderingContext2D,
  path: readonly Point[],
  size: number,
  style: string,
): void {
  const tip = path[path.length - 1] as Point
  const before = path[Math.max(0, path.length - 3)] as Point
  const angle = Math.atan2(tip.y - before.y, tip.x - before.x)
  ctx.save()
  ctx.translate(tip.x, tip.y)
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.quadraticCurveTo(size * 0.9, size * 0.1, size * 0.55, size * 0.9)
  ctx.lineWidth = 0.9
  ctx.strokeStyle = style
  ctx.stroke()
  ctx.restore()
}

function paintGlow(ctx: CanvasRenderingContext2D, at: Point, radius: number, style: string): void {
  if (radius <= 0.1) return
  const gradient = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, radius)
  gradient.addColorStop(0, style)
  gradient.addColorStop(1, style.replace(/[\d.]+\)$/, '0)'))
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(at.x, at.y, radius, 0, Math.PI * 2)
  ctx.fill()
}
