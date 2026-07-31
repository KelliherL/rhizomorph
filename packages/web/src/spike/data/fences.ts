/**
 * Lane geography (prd3 ruling 19) — the one data addition the prd allows.
 *
 * At dispatch the conductor writes `.swarm/lanes.json`: handle → fence globs →
 * issue → model. Off-fence detection falls out of it: a lane's recently-touched
 * files are matched against its own fence, and anything that matches somebody
 * *else's* fence instead is a trespass with a named victim.
 *
 * The manifest is a *contract*, not a guess. When it is absent (every live
 * stream today, since dispatch.sh does not write it yet) off-fence detection is
 * unavailable and says so in the gap voice — it is never inferred from lane
 * names, because a wrong fence would accuse an innocent lane.
 */

export interface LaneFence {
  handle: string
  /** Glob patterns, repo-relative. `packages/core/**` style. */
  fence: string[]
  issue: string | null
  model: string | null
}

export type LaneManifest = Record<string, LaneFence>

export interface Trespass {
  path: string
  /** The lane whose fence this path belongs to, when exactly one claims it. */
  victim: string | null
}

/**
 * Repo-relative path for a file a lane touched. Git reports paths relative to
 * the repo root already, so this is mostly a guard against absolute paths
 * sneaking in from a dirty-file payload.
 */
export function repoRelative(path: string): string {
  return path.replace(/^\/+/, '')
}

/**
 * Minimal glob matcher: `**` crosses directory separators, `*` does not, `?` is
 * one character. Enough for fence globs, and small enough to read — a fence is
 * a security-ish claim, so its matcher should be inspectable at a glance.
 */
export function globMatches(pattern: string, path: string): boolean {
  return globRegex(pattern).test(path)
}

const regexCache = new Map<string, RegExp>()

function globRegex(pattern: string): RegExp {
  const cached = regexCache.get(pattern)
  if (cached !== undefined) return cached

  let source = '^'
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i] as string
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` should also match zero directories: `a/**/b` matches `a/b`.
        if (pattern[i + 2] === '/') {
          source += '(?:.*/)?'
          i += 2
        } else {
          source += '.*'
          i += 1
        }
      } else {
        source += '[^/]*'
      }
      continue
    }
    if (char === '?') {
      source += '[^/]'
      continue
    }
    source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  source += '$'

  const regex = new RegExp(source)
  regexCache.set(pattern, regex)
  return regex
}

/** True when the path sits inside the lane's declared fence. */
export function insideFence(fence: LaneFence, path: string): boolean {
  const relative = repoRelative(path)
  return fence.fence.some((pattern) => globMatches(pattern, relative))
}

/**
 * Files this lane touched that its own fence does not claim, each attributed to
 * the lane whose fence *does* claim it. A path claimed by nobody is still a
 * trespass (it is outside the fence the lane agreed to) but has no victim, and
 * a path claimed by several lanes has no single victim to name.
 */
export function findTrespasses(
  manifest: LaneManifest,
  handle: string,
  touched: readonly string[],
): Trespass[] {
  const own = manifest[handle]
  if (own === undefined) return []

  const trespasses: Trespass[] = []
  for (const raw of touched) {
    const path = repoRelative(raw)
    if (insideFence(own, path)) continue

    const claimants = Object.values(manifest)
      .filter((fence) => fence.handle !== handle && insideFence(fence, path))
      .map((fence) => fence.handle)

    trespasses.push({ path, victim: claimants.length === 1 ? (claimants[0] as string) : null })
  }
  return trespasses
}
