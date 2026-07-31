/**
 * The stroke vocabulary.
 *
 * Everything the organism is drawn from is built here out of four marks —
 * the tapered ribbon, the thorn-curl, the arc and the dot — so a limb and the
 * glyph at its tip are visibly the same handwriting. Nothing in this file
 * knows what a token is; it is asked for a shape and it draws one.
 */

export interface Vec {
  x: number
  y: number
}

export interface Part {
  d: string
  /** Present → stroked at this width; absent → filled. */
  stroke?: number
  opacity?: number
  /** Rounded caps read as ink; butt caps read as broken bone. */
  cap?: 'round' | 'butt'
}

const round = (value: number): number => Math.round(value * 100) / 100

function moveTo(point: Vec): string {
  return `M${round(point.x)} ${round(point.y)}`
}

function lineTo(point: Vec): string {
  return `L${round(point.x)} ${round(point.y)}`
}

// --- the tapered ribbon --------------------------------------------------------

/**
 * A filled outline around a spine, with a half-width per sample. A ribbon that
 * ends at zero width comes to a real point — which is what makes the strokes
 * read as drawn with a nib rather than extruded from a line.
 */
export function ribbon(spine: readonly Vec[], halfWidths: readonly number[]): string {
  if (spine.length < 2) return ''
  const left: Vec[] = []
  const right: Vec[] = []

  for (let index = 0; index < spine.length; index += 1) {
    const previous = spine[Math.max(0, index - 1)] as Vec
    const next = spine[Math.min(spine.length - 1, index + 1)] as Vec
    const point = spine[index] as Vec
    const tx = next.x - previous.x
    const ty = next.y - previous.y
    const length = Math.hypot(tx, ty) || 1
    const nx = -ty / length
    const ny = tx / length
    const half = halfWidths[index] ?? 0
    left.push({ x: point.x + nx * half, y: point.y + ny * half })
    right.push({ x: point.x - nx * half, y: point.y - ny * half })
  }

  const forward = left.map((point, index) => (index === 0 ? moveTo(point) : lineTo(point)))
  const back = right.reverse().map((point) => lineTo(point))
  return `${forward.join('')}${back.join('')}Z`
}

/** `taper(n, w0, w1, power)` — a width profile that thins toward the tip. */
export function taper(count: number, base: number, tip: number, power = 1.7): number[] {
  return Array.from({ length: count }, (_unused, index) => {
    const t = count === 1 ? 1 : index / (count - 1)
    return base + (tip - base) * Math.pow(t, power)
  })
}

// --- spines --------------------------------------------------------------------

export function sampleCubic(a: Vec, c1: Vec, c2: Vec, b: Vec, count: number): Vec[] {
  return Array.from({ length: count }, (_unused, index) => {
    const t = index / (count - 1)
    const u = 1 - t
    return {
      x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
      y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
    }
  })
}

function unit(from: Vec, to: Vec): Vec {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy) || 1
  return { x: dx / length, y: dy / length }
}

function perp(v: Vec): Vec {
  return { x: -v.y, y: v.x }
}

/**
 * The default limb: a calligraphic sweep from the core to a lane. `bias` is the
 * side and depth of the curve — deterministic per lane, so the field keeps its
 * handwriting between renders.
 */
export function sweptSpine(from: Vec, to: Vec, bias: number, count = 34): Vec[] {
  const direction = unit(from, to)
  const normal = perp(direction)
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  const bow = distance * bias
  const c1 = {
    x: from.x + direction.x * distance * 0.35 + normal.x * bow,
    y: from.y + direction.y * distance * 0.35 + normal.y * bow,
  }
  const c2 = {
    x: from.x + direction.x * distance * 0.72 + normal.x * bow * 0.55,
    y: from.y + direction.y * distance * 0.72 + normal.y * bow * 0.55,
  }
  return sampleCubic(from, c1, c2, to, count)
}

/**
 * LOOPING. The limb leaves its path and circles — one visible closed cycle,
 * returning to where it already was before carrying on. Two turns, tightening,
 * because a loop that widens reads as progress.
 */
export function coiledSpine(from: Vec, to: Vec, bias: number): Vec[] {
  const direction = unit(from, to)
  const normal = perp(direction)
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  const radius = Math.max(11, distance * 0.12)
  const turns = 2
  const march = radius * 0.9

  // The coil sits in the outer half of the limb, so it reads as belonging to
  // the lane it ends at rather than to the core it left.
  const base = at(from, direction, distance * 0.55)
  const head = sweptSpine(from, base, bias * 0.5, 16)

  // Each turn leaves the line and comes back to it a little further along, so
  // the limb visibly travels round and arrives where it already was.
  const coil: Vec[] = []
  const steps = 26 * turns
  for (let index = 0; index <= steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2 * turns
    const along = radius * Math.sin(angle) + (march * angle) / (Math.PI * 2)
    const across = radius * (1 - Math.cos(angle))
    coil.push({
      x: base.x + direction.x * along + normal.x * across,
      y: base.y + direction.y * along + normal.y * across,
    })
  }

  const exit = coil[coil.length - 1] as Vec
  const tail = sweptSpine(exit, to, bias * 0.3, 12)
  return [...head, ...coil.slice(1), ...tail.slice(1)]
}

/**
 * WAITING. The last third lifts clear of the field and opens upward. Nothing
 * else in the vocabulary points away from the plane, so a raised limb is
 * unmistakable at a glance — and it is curved and open where FROZEN is
 * straight and shut.
 */
export function raisedSpine(from: Vec, to: Vec, bias: number): Vec[] {
  const direction = unit(from, to)
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  const lift = Math.max(30, distance * 0.34)
  const elbow = { x: from.x + direction.x * distance * 0.52, y: from.y + direction.y * distance * 0.52 + lift * 0.3 }
  const shaft = sweptSpine(from, elbow, bias * 0.4, 18)
  // The second control point sits *below* the tip, so the limb arrives moving
  // straight upward — the arm is still rising at the moment it stops.
  const forearm = sampleCubic(
    elbow,
    { x: elbow.x + direction.x * distance * 0.18, y: elbow.y + lift * 0.15 },
    { x: to.x, y: to.y + lift * 0.95 },
    to,
    20,
  )
  return [...shaft, ...forearm.slice(1)]
}

/**
 * OFF-FENCE. The limb abandons its own radial and reaches sideways, across the
 * field, toward the territory it is touching. The trespass is the geometry:
 * the limb is somewhere it has no business being.
 */
export function trespassSpine(from: Vec, to: Vec, toward: Vec): Vec[] {
  const direction = unit(from, to)
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  const elbow = at(from, direction, distance * 0.55)
  const shaft = sweptSpine(from, elbow, 0.1, 18)
  const reach = sampleCubic(
    elbow,
    { x: elbow.x + (toward.x - elbow.x) * 0.3, y: elbow.y + (toward.y - elbow.y) * 0.3 },
    { x: to.x + (toward.x - to.x) * 0.45, y: to.y + (toward.y - to.y) * 0.45 },
    to,
    20,
  )
  return [...shaft, ...reach]
}

/**
 * FROZEN. No curve, no give: a straight run, drawn as separated shards so the
 * limb reads as brittle rather than merely dim.
 */
export function shardSpines(from: Vec, to: Vec): Vec[][] {
  const shards: Vec[][] = []
  const cuts = [
    [0.0, 0.3],
    [0.38, 0.62],
    [0.7, 1.0],
  ] as const
  for (const [a, b] of cuts) {
    shards.push([
      { x: from.x + (to.x - from.x) * a, y: from.y + (to.y - from.y) * a },
      { x: from.x + (to.x - from.x) * b, y: from.y + (to.y - from.y) * b },
    ])
  }
  return shards
}

function at(origin: Vec, direction: Vec, distance: number): Vec {
  return { x: origin.x + direction.x * distance, y: origin.y + direction.y * distance }
}

// --- thorns --------------------------------------------------------------------

/**
 * A thorn-curl off a spine: out along the normal, then hooked back along the
 * tangent, tapering to nothing. The organism's punctuation mark.
 */
export function thorn(spine: readonly Vec[], t: number, length: number, side: 1 | -1): string {
  const index = Math.min(spine.length - 2, Math.max(1, Math.round(t * (spine.length - 1))))
  const point = spine[index] as Vec
  const next = spine[index + 1] as Vec
  const previous = spine[index - 1] as Vec
  const tangent = unit(previous, next)
  const normal = perp(tangent)
  const curl: Vec[] = [
    point,
    {
      x: point.x + normal.x * length * side * 0.55 + tangent.x * length * 0.25,
      y: point.y + normal.y * length * side * 0.55 + tangent.y * length * 0.25,
    },
    {
      x: point.x + normal.x * length * side * 0.95 + tangent.x * length * 0.75,
      y: point.y + normal.y * length * side * 0.95 + tangent.y * length * 0.75,
    },
    {
      x: point.x + normal.x * length * side * 0.75 + tangent.x * length * 1.2,
      y: point.y + normal.y * length * side * 0.75 + tangent.y * length * 1.2,
    },
  ]
  return ribbon(curl, taper(curl.length, length * 0.22, 0, 1.2))
}

/** Heat spines: short, dense, radiating both ways. EXPENSIVE's texture. */
export function heatSpines(spine: readonly Vec[], length: number, count: number): string {
  const parts: string[] = []
  for (let index = 0; index < count; index += 1) {
    const t = 0.15 + (index / Math.max(1, count - 1)) * 0.75
    const side: 1 | -1 = index % 2 === 0 ? 1 : -1
    const position = Math.min(spine.length - 2, Math.max(1, Math.round(t * (spine.length - 1))))
    const point = spine[position] as Vec
    const tangent = unit(spine[position - 1] as Vec, spine[position + 1] as Vec)
    const normal = perp(tangent)
    const tip = {
      x: point.x + normal.x * length * side + tangent.x * length * 0.45,
      y: point.y + normal.y * length * side + tangent.y * length * 0.45,
    }
    parts.push(ribbon([point, tip], [length * 0.2, 0]))
  }
  return parts.join(' ')
}

// --- arcs and rings -------------------------------------------------------------

export function arc(centre: Vec, radius: number, from: number, to: number): string {
  const start = { x: centre.x + Math.cos(from) * radius, y: centre.y + Math.sin(from) * radius }
  const end = { x: centre.x + Math.cos(to) * radius, y: centre.y + Math.sin(to) * radius }
  const large = Math.abs(to - from) > Math.PI ? 1 : 0
  const sweep = to > from ? 1 : 0
  return `${moveTo(start)}A${round(radius)} ${round(radius)} 0 ${large} ${sweep} ${round(end.x)} ${round(end.y)}`
}

export function ring(centre: Vec, radius: number): string {
  return `${moveTo({ x: centre.x - radius, y: centre.y })}a${round(radius)} ${round(radius)} 0 1 0 ${round(radius * 2)} 0a${round(radius)} ${round(radius)} 0 1 0 ${round(-radius * 2)} 0`
}

export function dot(centre: Vec, radius: number): string {
  return ring(centre, radius)
}

/** A straight tapered stroke between two points — the glyph stem. */
export function stroke(from: Vec, to: Vec, base: number, tip: number): string {
  return ribbon([from, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, to], [base, (base + tip) / 2, tip])
}
