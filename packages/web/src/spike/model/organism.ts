import {
  selectLaneSpend,
  selectRoleSpend,
  selectSessionSpend,
  selectSpendRate,
  selectSpendRateByLane,
  selectTouchesByBranch,
  type AgentRole,
  type AgentStatus,
  type AgentThread,
  type LaneSpend,
  type SessionState,
} from '@observatory/core'

/**
 * The organism's read of the log.
 *
 * Everything the scene, the attention strip, the burn strip and the fleet
 * table draw is derived here, once, from the same `SessionState` every other
 * consumer folds. The renderer knows about limbs and glyphs; it knows nothing
 * about tokens, and nothing here knows about pixels.
 */

// --- the ladder ---------------------------------------------------------------

/** prd3 ruling 8. Hue belongs to this and to nothing else. */
export type Ladder = 'calm' | 'notice' | 'needs-you' | 'broken'

export const LADDER_RANK: Record<Ladder, number> = {
  calm: 0,
  notice: 1,
  'needs-you': 2,
  broken: 3,
}

/** prd3 ruling 18. Each one is a limb behaviour, not a badge. */
export type Pathology = 'looping' | 'frozen' | 'waiting' | 'expensive' | 'off-fence'

/** Which rung a pathology puts a lane on. Form says *which*, hue says *how bad*. */
export const PATHOLOGY_LADDER: Record<Pathology, Ladder> = {
  frozen: 'broken',
  looping: 'needs-you',
  waiting: 'needs-you',
  'off-fence': 'needs-you',
  expensive: 'notice',
}

// --- thresholds ---------------------------------------------------------------

/** Silence past this and a working lane has stiffened. */
export const FROZEN_AFTER_MS = 5 * 60_000
/** Recency ramp: a limb is fully lit at 0, fully faded at this age. */
export const RECENCY_FADE_MS = 12 * 60_000
/** Window the loop detector and the burn-outlier test both look back over. */
export const PATHOLOGY_WINDOW_MS = 8 * 60_000
/** A lane must burn this many times the fleet median before it counts as hot. */
export const EXPENSIVE_MULTIPLE = 2.5
/** …and clear this floor, so a sleepy fleet cannot manufacture an outlier. */
export const EXPENSIVE_FLOOR_TOKENS_PER_MIN = 120

// --- shapes -------------------------------------------------------------------

/** A second-generation filament: one thread inside a lane's session. */
export interface Filament {
  id: string
  /** `main` / `subagent` / `auxiliary`, or `?` when the source never said. */
  thread: AgentThread | null
  label: string
  outputTokens: number
  costUsd: number
  requestCount: number
  toolCalls: number
  lastTs: number | null
}

export interface LoopEvidence {
  /** e.g. `Read → Edit → Bash`. */
  cycle: string[]
  repeats: number
}

export interface Lane {
  id: string
  label: string
  branch: string | null
  worktreePath: string | null
  role: AgentRole
  isConductor: boolean
  /** Worktree gone, or workmux says done: retired, not sick. */
  retired: boolean
  outputTokens: number
  costUsd: number
  costKnown: boolean
  requestCount: number
  toolCalls: number
  models: string[]
  /** Newest fact of any kind about this lane. Null when we have never seen one. */
  lastTs: number | null
  ageMs: number | null
  /** Output tokens per minute over {@link PATHOLOGY_WINDOW_MS}. */
  burnPerMin: number
  agentStatus: AgentStatus | null
  detail: string | null
  filaments: Filament[]
  pathologies: Pathology[]
  ladder: Ladder
  loop: LoopEvidence | null
  /** Lane whose territory this one has reached into, when off-fence. */
  trespassInto: string | null
  trespassPaths: string[]
  /** True when WAITING came from workmux's own word rather than a guess. */
  waitingDeclared: boolean
  /** True when the fence came from a lane manifest, false when we inferred it. */
  fenceDeclared: boolean
}

export interface AttentionItem {
  laneId: string
  label: string
  ladder: Ladder
  pathology: Pathology
  /** One terse clause: what is wrong. */
  why: string
  /** How long it has been that way, already formatted. */
  since: string
}

export interface BurnStrip {
  outputTokens: number
  costUsd: number
  /** False when no `llm.cost` event has ever arrived — "unknown", not "$0.00". */
  costKnown: boolean
  costAuthoritative: boolean | null
  costPerHour: number
  outputPerMin: number
  overheadRatio: number | null
  /** Gap-voice line (ruling 12), or null when the feed is healthy. */
  costGap: string | null
}

export interface Organism {
  now: number
  repoName: string | null
  mainBranch: string | null
  core: {
    commits: number
    worktrees: number
    lanes: number
    lastTs: number | null
  }
  lanes: Lane[]
  attention: AttentionItem[]
  burn: BurnStrip
  /** Evidence for the calm state — never bare reassurance (ruling 14). */
  evidence: { lanes: number; branches: number; files: number }
  eventCount: number
}

// --- fences (ruling 19) --------------------------------------------------------

/**
 * `.swarm/lanes.json` in miniature: handle → fence globs. The fixtures ship one;
 * live has none yet, so {@link inferFences} stands in and every finding it
 * produces is labelled as inferred rather than declared.
 */
export type LaneManifest = Record<string, string[]>

/** Prefix match on the glob's literal head — enough for `packages/web/**`. */
function underFence(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => {
    const head = glob.split('*')[0] ?? glob
    return head.length > 0 && path.startsWith(head)
  })
}

/**
 * A lane's territory, learned from where it has already committed. Two path
 * segments deep: `packages/web/src/x.ts` → `packages/web/`. A lane that has
 * committed nothing has no inferred territory and is never accused.
 */
function inferFences(state: SessionState): LaneManifest {
  const fences: LaneManifest = {}
  for (const branch of Object.values(state.branches)) {
    const dirs = new Set<string>()
    for (const sha of branch.commits) {
      for (const file of state.commits[sha]?.files ?? []) {
        const parts = file.path.split('/')
        dirs.add(parts.length > 2 ? `${parts[0]}/${parts[1]}/` : `${parts[0]}/`)
      }
    }
    if (dirs.size > 0) fences[branch.name] = [...dirs]
  }
  return fences
}

// --- the build -----------------------------------------------------------------

export interface OrganismOptions {
  now: number
  /** Declared fences. Absent → inferred from committed territory. */
  manifest?: LaneManifest
}

export function buildOrganism(state: SessionState, options: OrganismOptions): Organism {
  const { now } = options

  const laneSpend = selectLaneSpend(state)
  const rates = selectSpendRateByLane(state, { now, windowMs: PATHOLOGY_WINDOW_MS })
  const fences = options.manifest ?? inferFences(state)
  const declaredFences = options.manifest !== undefined
  const touches = selectTouchesByBranch(state)

  const lanes: Lane[] = laneSpend.map((spend) =>
    buildLane(state, spend, {
      now,
      burnPerMin: (rates[spend.lane]?.totals.tokens.output ?? 0) / (PATHOLOGY_WINDOW_MS / 60_000),
    }),
  )

  // --- expensive is a fleet-relative judgement, so it needs every lane first.
  const burns = lanes.filter((lane) => !lane.retired && lane.burnPerMin > 0).map((l) => l.burnPerMin)
  const median = medianOf(burns)
  for (const lane of lanes) {
    if (lane.retired) continue
    if (
      median > 0 &&
      lane.burnPerMin >= median * EXPENSIVE_MULTIPLE &&
      lane.burnPerMin >= EXPENSIVE_FLOOR_TOKENS_PER_MIN
    ) {
      lane.pathologies.push('expensive')
    }
  }

  // --- off-fence needs the whole map: whose territory did it wander into?
  for (const lane of lanes) {
    if (lane.retired || lane.branch === null) continue
    const own = fences[lane.branch] ?? fences[lane.id]
    if (own === undefined || own.length === 0) continue
    const strayed: string[] = []
    let into: string | null = null
    for (const touch of touches[lane.branch] ?? []) {
      if (!touch.dirty) continue
      if (underFence(touch.path, own)) continue
      const owner = Object.entries(fences).find(
        ([name, globs]) => name !== lane.branch && underFence(touch.path, globs),
      )
      if (owner === undefined) continue
      strayed.push(touch.path)
      into ??= owner[0]
    }
    if (strayed.length > 0) {
      lane.pathologies.push('off-fence')
      lane.trespassInto = into
      lane.trespassPaths = strayed
      lane.fenceDeclared = declaredFences
    }
  }

  for (const lane of lanes) lane.ladder = ladderOf(lane)

  const spend = selectSessionSpend(state)
  const rate = selectSpendRate(state, { now, windowMs: PATHOLOGY_WINDOW_MS })
  const roles = selectRoleSpend(state)
  const costKnown = spend.costEventCount > 0

  const ordered = [...lanes].sort(
    (a, b) =>
      LADDER_RANK[b.ladder] - LADDER_RANK[a.ladder] ||
      b.outputTokens - a.outputTokens ||
      a.id.localeCompare(b.id),
  )

  return {
    now,
    repoName: state.session?.repoName ?? null,
    mainBranch: state.mainBranch,
    core: {
      commits: state.commitOrder.length,
      worktrees: Object.values(state.worktrees).filter((w) => w.present).length,
      lanes: lanes.filter((lane) => !lane.retired).length,
      lastTs: state.lastEventTs,
    },
    lanes: ordered,
    attention: attentionFrom(ordered, now),
    burn: {
      outputTokens: spend.tokens.output,
      costUsd: spend.costUsd,
      costKnown,
      costAuthoritative: spend.costIsAuthoritative,
      costPerHour: rate.costUsdPerHour,
      outputPerMin: rate.totals.tokens.output / (PATHOLOGY_WINDOW_MS / 60_000),
      overheadRatio: roles.overheadRatio,
      costGap: costKnown
        ? null
        : 'NO COST FEED (OTel) — dollars unavailable — run: eval "$(observatory env <lane>)"',
    },
    evidence: {
      lanes: lanes.length,
      branches: Object.keys(state.branches).length,
      files: new Set(Object.values(touches).flatMap((list) => list.map((t) => t.path))).size,
    },
    eventCount: state.eventCount,
  }
}

interface LaneBuildContext {
  now: number
  burnPerMin: number
}

function buildLane(state: SessionState, spend: LaneSpend, ctx: LaneBuildContext): Lane {
  const { now } = ctx
  const agent = agentFor(state, spend)
  const worktree = spend.worktreePath === null ? undefined : state.worktrees[spend.worktreePath]
  const lastTs = laneLastTs(state, spend)
  const ageMs = lastTs === null ? null : Math.max(0, now - lastTs)
  const retired = agent?.status === 'done' || (worktree !== undefined && !worktree.present)
  const isConductor = spend.roles.includes('conductor') && !spend.roles.includes('worker')

  const pathologies: Pathology[] = []
  const loop = detectLoop(state, spend.lane, now)
  if (!retired && loop !== null) pathologies.push('looping')
  if (!retired && agent?.status === 'waiting') pathologies.push('waiting')
  if (
    !retired &&
    !pathologies.includes('waiting') &&
    ageMs !== null &&
    ageMs >= FROZEN_AFTER_MS &&
    spend.requestCount + spend.toolCallCount > 0
  ) {
    pathologies.push('frozen')
  }

  return {
    id: spend.lane,
    label: spend.lane,
    branch: spend.branch,
    worktreePath: spend.worktreePath,
    role: spend.roles[0] ?? 'unattributed',
    isConductor,
    retired,
    outputTokens: spend.tokens.output,
    costUsd: spend.costUsd,
    costKnown: spend.costEventCount > 0,
    requestCount: spend.requestCount,
    toolCalls: spend.toolCallCount,
    models: spend.models,
    lastTs,
    ageMs,
    burnPerMin: ctx.burnPerMin,
    agentStatus: agent?.status ?? null,
    detail: agent?.detail ?? null,
    filaments: filamentsOf(state, spend.lane),
    pathologies,
    ladder: 'calm',
    loop,
    trespassInto: null,
    trespassPaths: [],
    waitingDeclared: agent !== undefined,
    fenceDeclared: false,
  }
}

/** Records this far apart belong to different subagent runs. */
export const FILAMENT_GAP_MS = 3 * 60_000

/**
 * Second growth, one node per *run* rather than one per thread bucket.
 *
 * `main` is the lane's own trunk and never a filament — only what it spawned
 * is. The log carries no subagent id (prd2 landed `thread`, not identity), so
 * a run is defined the only honest way available: consecutive non-main records
 * inside the same thread, split wherever the lane went quiet for longer than
 * {@link FILAMENT_GAP_MS}. Two subagents dispatched back to back therefore read
 * as one filament; that undercounts, which is the safe direction.
 */
function filamentsOf(state: SessionState, lane: string): Filament[] {
  interface Record_ {
    ts: number
    thread: AgentThread | null
    output: number
    cost: number
    requests: number
    tools: number
  }

  const records: Record_[] = []
  const spawned = (thread: AgentThread | null): boolean => thread !== null && thread !== 'main'

  for (const usage of state.telemetry.usage) {
    if (usage.lane !== lane || !spawned(usage.thread)) continue
    records.push({
      ts: usage.ts,
      thread: usage.thread,
      output: usage.tokens.output,
      cost: 0,
      requests: 1,
      tools: 0,
    })
  }
  for (const cost of state.telemetry.costs) {
    if (cost.lane !== lane || !spawned(cost.thread)) continue
    records.push({ ts: cost.ts, thread: cost.thread, output: 0, cost: cost.costUsd, requests: 0, tools: 0 })
  }
  for (const tool of state.telemetry.tools) {
    if (tool.lane !== lane || !spawned(tool.thread)) continue
    records.push({ ts: tool.ts, thread: tool.thread, output: 0, cost: 0, requests: 0, tools: 1 })
  }
  if (records.length === 0) return []

  records.sort((a, b) => a.ts - b.ts)

  const filaments: Filament[] = []
  const counts = new Map<string, number>()
  let current: Filament | null = null
  let previousTs = 0
  let previousThread: AgentThread | null = null

  for (const record of records) {
    const isNewRun =
      current === null || record.thread !== previousThread || record.ts - previousTs > FILAMENT_GAP_MS
    if (isNewRun) {
      const key = record.thread ?? 'unknown'
      const ordinal = (counts.get(key) ?? 0) + 1
      counts.set(key, ordinal)
      current = {
        id: `${lane}::${key}::${ordinal}`,
        thread: record.thread,
        label: `${key === 'subagent' ? 'sub' : key} ${ordinal}`,
        outputTokens: 0,
        costUsd: 0,
        requestCount: 0,
        toolCalls: 0,
        lastTs: null,
      }
      filaments.push(current)
    }
    const run = current as Filament
    run.outputTokens += record.output
    run.costUsd += record.cost
    run.requestCount += record.requests
    run.toolCalls += record.tools
    run.lastTs = record.ts
    previousTs = record.ts
    previousThread = record.thread
  }

  return filaments.sort((a, b) => b.outputTokens - a.outputTokens)
}

function agentFor(state: SessionState, spend: LaneSpend) {
  const direct = state.agents[spend.lane]
  if (direct !== undefined) return direct
  return Object.values(state.agents).find(
    (agent) =>
      (spend.branch !== null && agent.branch === spend.branch) ||
      (spend.worktreePath !== null && agent.worktreePath === spend.worktreePath),
  )
}

/** Newest fact of any kind: telemetry, the agent's own word, or a live pane. */
function laneLastTs(state: SessionState, spend: LaneSpend): number | null {
  let latest = spend.lastTs
  const bump = (ts: number | null | undefined) => {
    if (ts !== null && ts !== undefined && (latest === null || ts > latest)) latest = ts
  }
  bump(agentFor(state, spend)?.updatedAt)
  if (spend.worktreePath !== null) {
    for (const pane of Object.values(state.panes)) {
      if (pane.worktreePath === spend.worktreePath && pane.present) bump(pane.lastActivityTs)
    }
  }
  if (spend.branch !== null) bump(state.branches[spend.branch]?.updatedAt)
  return latest
}

/**
 * A repeating tool-call cycle with nothing to show for it. Looks for a period
 * of 2–4 that repeats at least three times at the tail of the lane's recent
 * calls, and only calls it a loop when no commit landed on the lane's branch
 * inside the same window — repetition *with* progress is just work.
 */
function detectLoop(state: SessionState, lane: string, now: number): LoopEvidence | null {
  const since = now - PATHOLOGY_WINDOW_MS
  const calls = state.telemetry.tools
    .filter((record) => record.lane === lane && record.ts >= since && record.ts <= now)
    .map((record) => record.tool)
  if (calls.length < 6) return null

  const branch = state.telemetry.tools.find((record) => record.lane === lane)?.branch ?? null
  if (branch !== null) {
    const landed = (state.branches[branch]?.commits ?? []).some((sha) => {
      const commit = state.commits[sha]
      return commit !== undefined && commit.landedAt >= since
    })
    if (landed) return null
  }

  for (let period = 2; period <= 4; period += 1) {
    let repeats = 0
    for (let block = 0; ; block += 1) {
      const end = calls.length - block * period
      const start = end - period
      const prevStart = start - period
      if (prevStart < 0) break
      const same = calls
        .slice(start, end)
        .every((tool, index) => tool === calls[prevStart + index])
      if (!same) break
      repeats += 1
    }
    if (repeats >= 2) {
      return { cycle: calls.slice(calls.length - period), repeats: repeats + 1 }
    }
  }
  return null
}

function ladderOf(lane: Lane): Ladder {
  if (lane.retired) return 'calm'
  let worst: Ladder = 'calm'
  for (const pathology of lane.pathologies) {
    const rung = PATHOLOGY_LADDER[pathology]
    if (LADDER_RANK[rung] > LADDER_RANK[worst]) worst = rung
  }
  return worst
}

function attentionFrom(lanes: readonly Lane[], now: number): AttentionItem[] {
  const items: AttentionItem[] = []
  for (const lane of lanes) {
    for (const pathology of lane.pathologies) {
      if (PATHOLOGY_LADDER[pathology] === 'notice') continue
      items.push({
        laneId: lane.id,
        label: lane.label,
        ladder: PATHOLOGY_LADDER[pathology],
        pathology,
        why: whyOf(lane, pathology),
        since: lane.ageMs === null ? '—' : formatAge(lane.ageMs),
      })
    }
  }
  return items.sort(
    (a, b) => LADDER_RANK[b.ladder] - LADDER_RANK[a.ladder] || a.label.localeCompare(b.label),
  )
}

function whyOf(lane: Lane, pathology: Pathology): string {
  switch (pathology) {
    case 'looping':
      return lane.loop === null
        ? 'repeating with no progress'
        : `${lane.loop.cycle.join('→')} ×${lane.loop.repeats}, no commit`
    case 'frozen':
      return 'no events — flatline'
    case 'waiting':
      return lane.waitingDeclared ? 'hand raised — waiting on you' : 'stopped (pane signal only)'
    case 'off-fence':
      return `touching ${lane.trespassInto ?? 'another lane'} — ${lane.trespassPaths.length} file${lane.trespassPaths.length === 1 ? '' : 's'}`
    case 'expensive':
      return 'burn outlier vs fleet'
  }
}

export function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h${String(minutes % 60).padStart(2, '0')}`
}

function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
}

/** 0 = just moved, 1 = long dead. The recency ramp every limb dims along. */
export function recencyOf(lane: Lane): number {
  if (lane.ageMs === null) return 1
  return Math.min(1, lane.ageMs / RECENCY_FADE_MS)
}
