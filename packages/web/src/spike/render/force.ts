/**
 * A small deterministic force field.
 *
 * Obsidian-floaty, but not perpetually adrift: the motion law (ruling 10)
 * spends motion on events, so the simulation is run to rest whenever the
 * topology changes and then held. Nothing here reads a clock or a random
 * number — the same organism always settles into the same field, which is
 * what makes a screenshot reproducible and a glance repeatable.
 */

export interface ForceNode {
  id: string
  /** 0 = the sigil-core, 1 = a lane, 2 = a subagent filament tip. */
  generation: 0 | 1 | 2
  /** Parent node id; null for the core. */
  parent: string | null
  /** Drawn radius — drives both collision and the link's rest length. */
  radius: number
  /** How far from its parent this node wants to sit. */
  linkDistance: number
  /** Higher = harder to shove. Big lanes hold their ground. */
  mass: number
  /**
   * A second, weaker attraction to a node that is not this one's parent. Only
   * an off-fence lane has one: it is drawn toward the territory it is touching,
   * so the trespass is a fact about where the limb *is*, not just a badge.
   */
  pull: { to: string; strength: number } | null
  x: number
  y: number
  vx: number
  vy: number
}

export interface ForceOptions {
  iterations?: number
  /** Repulsion constant. Scaled by node radii, so big nodes clear more room. */
  charge?: number
  linkStiffness?: number
  /**
   * Pull toward the origin. Stronger vertically than horizontally on purpose:
   * a field flattened into a wide oval fills a landscape frame instead of
   * leaving a third of it empty either side, and the extra room across is
   * where twenty lanes get their elbows.
   */
  gravityX?: number
  gravityY?: number
  damping?: number
}

const DEFAULTS: Required<ForceOptions> = {
  iterations: 700,
  charge: 950,
  linkStiffness: 0.085,
  gravityX: 0.0008,
  gravityY: 0.005,
  damping: 0.86,
}

/** Deterministic unit angle from a string — the seed that replaces `Math.random`. */
export function hashAngle(id: string): number {
  let hash = 2166136261
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) % 100000) / 100000
}

export interface SeedSpec {
  id: string
  generation: 0 | 1 | 2
  parent: string | null
  radius: number
  linkDistance: number
  mass: number
  pull?: { to: string; strength: number }
}

/**
 * Seed positions on a golden-angle spiral around the parent. Starting from a
 * sane spread rather than a random cloud is most of what keeps the settled
 * field legible at twenty lanes: the simulation only has to relax it, not
 * untangle it.
 */
export function seedNodes(specs: readonly SeedSpec[]): ForceNode[] {
  const byId = new Map<string, ForceNode>()
  const nodes: ForceNode[] = []
  const siblingIndex = new Map<string, number>()

  for (const spec of specs) {
    const parentKey = spec.parent ?? '@root'
    const index = siblingIndex.get(parentKey) ?? 0
    siblingIndex.set(parentKey, index + 1)
    const parent = spec.parent === null ? undefined : byId.get(spec.parent)
    // Golden angle keeps successive siblings maximally apart; the hash breaks
    // ties between two organisms of the same shape.
    const angle = index * 2.39996 + hashAngle(spec.id) * 0.9
    const node: ForceNode = {
      id: spec.id,
      generation: spec.generation,
      parent: spec.parent,
      radius: spec.radius,
      linkDistance: spec.linkDistance,
      mass: spec.mass,
      pull: spec.pull ?? null,
      x: (parent?.x ?? 0) + Math.cos(angle) * spec.linkDistance,
      y: (parent?.y ?? 0) + Math.sin(angle) * spec.linkDistance,
      vx: 0,
      vy: 0,
    }
    byId.set(node.id, node)
    nodes.push(node)
  }
  return nodes
}

/** Runs the field to rest, in place. ~120 nodes × 700 ticks is a few ms. */
export function settle(nodes: ForceNode[], options: ForceOptions = {}): ForceNode[] {
  const { iterations, charge, linkStiffness, gravityX, gravityY, damping } = {
    ...DEFAULTS,
    ...options,
  }
  const index = new Map(nodes.map((node) => [node.id, node]))

  for (let step = 0; step < iterations; step += 1) {
    // Cooling: early ticks move freely, late ticks only polish.
    const alpha = 1 - step / iterations

    for (let a = 0; a < nodes.length; a += 1) {
      const first = nodes[a] as ForceNode
      for (let b = a + 1; b < nodes.length; b += 1) {
        const second = nodes[b] as ForceNode
        let dx = second.x - first.x
        let dy = second.y - first.y
        let distanceSq = dx * dx + dy * dy
        if (distanceSq < 1e-6) {
          // Perfectly coincident nodes get a deterministic nudge apart.
          dx = (hashAngle(first.id) - 0.5) * 0.1
          dy = (hashAngle(second.id) - 0.5) * 0.1
          distanceSq = dx * dx + dy * dy + 1e-6
        }
        const distance = Math.sqrt(distanceSq)
        // Generous clearance: a limb's ornament (a coil, a cartouche, a label)
        // lives outside the node's own radius, so discs that merely fail to
        // overlap still read as collided.
        const clearance = first.radius + second.radius + 34
        // Inverse-square repulsion, plus a hard shove once discs overlap.
        const push =
          (charge * (first.radius + second.radius)) / (distanceSq * 0.5 + 400) +
          (distance < clearance ? (clearance - distance) * 0.9 : 0)
        const ux = dx / distance
        const uy = dy / distance
        first.vx -= (ux * push) / first.mass
        first.vy -= (uy * push) / first.mass
        second.vx += (ux * push) / second.mass
        second.vy += (uy * push) / second.mass
      }
    }

    for (const node of nodes) {
      if (node.parent !== null) {
        const parent = index.get(node.parent)
        if (parent !== undefined) {
          const dx = node.x - parent.x
          const dy = node.y - parent.y
          const distance = Math.hypot(dx, dy) || 1e-6
          const pull = (distance - node.linkDistance) * linkStiffness
          const ux = dx / distance
          const uy = dy / distance
          node.vx -= (ux * pull) / node.mass
          node.vy -= (uy * pull) / node.mass
          parent.vx += (ux * pull) / parent.mass
          parent.vy += (uy * pull) / parent.mass
        }
      }
      if (node.pull !== null) {
        const target = index.get(node.pull.to)
        if (target !== undefined) {
          node.vx += (target.x - node.x) * node.pull.strength
          node.vy += (target.y - node.y) * node.pull.strength
        }
      }
      node.vx -= node.x * gravityX
      node.vy -= node.y * gravityY
    }

    for (const node of nodes) {
      if (node.generation === 0) {
        // The core is the origin. Everything else arranges itself around it.
        node.x = 0
        node.y = 0
        node.vx = 0
        node.vy = 0
        continue
      }
      node.vx *= damping
      node.vy *= damping
      node.x += node.vx * alpha
      node.y += node.vy * alpha
    }
  }

  // Second growth stays near what grew it. Without this a filament shoved out
  // by a big neighbour ends up across the field, reading as a lane of its own
  // and stretching the frame around empty space.
  for (const node of nodes) {
    if (node.generation !== 2 || node.parent === null) continue
    const parent = index.get(node.parent)
    if (parent === undefined) continue
    const dx = node.x - parent.x
    const dy = node.y - parent.y
    const distance = Math.hypot(dx, dy) || 1e-6
    const limit = node.linkDistance * 1.45
    if (distance > limit) {
      node.x = parent.x + (dx / distance) * limit
      node.y = parent.y + (dy / distance) * limit
    }
  }
  return nodes
}

export interface Bounds {
  minX: number
  minY: number
  width: number
  height: number
}

/**
 * The frame the settled field needs. Auto-fitting rather than assuming a fixed
 * radius is what makes ruling 22 ("render everything, always") survive: four
 * lanes and forty lanes both arrive framed, one just at a smaller scale.
 */
export function boundsOf(nodes: readonly ForceNode[], padding: number): Bounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.radius)
    minY = Math.min(minY, node.y - node.radius)
    maxX = Math.max(maxX, node.x + node.radius)
    maxY = Math.max(maxY, node.y + node.radius)
  }
  if (!Number.isFinite(minX)) return { minX: -200, minY: -200, width: 400, height: 400 }
  return {
    minX: minX - padding,
    minY: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  }
}
