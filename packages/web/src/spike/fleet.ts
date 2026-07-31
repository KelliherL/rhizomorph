import {
  DEFAULT_SPEND_WINDOW_MS,
  reduceAll,
  selectCollisionPairs,
  selectCollisions,
  selectLaneSpend,
  selectOverheadRatio,
  selectSpendRateByLane,
  selectTouchesByBranch,
  selectWorktreeViews,
  type AgentStatus,
  type LaneSpend,
  type ObservatoryEvent,
  type SessionState,
  type TelemetryOrigin,
} from '@observatory/core'

/**
 * SPIKE A — the fleet read.
 *
 * One fold of the event log into "what does the operator need to know about
 * each lane", plus the five pathology detectors from prd3 ruling 18. Pure:
 * `now` is injected, never read from the clock, so a screenshot and a replay
 * of the same moment agree.
 *
 * Everything arithmetic comes from `@observatory/core` selectors — this module
 * joins and classifies, it never sums.
 */

// ── thresholds ──────────────────────────────────────────────────────────────

/** Silence past this and a lane is FROZEN. */
export const FROZEN_MS = 4 * 60_000
/** Silence past this and a lane has visibly gone quiet (recency ramp bottoms out). */
export const COLD_MS = 6 * 60_000
/** A repeating tool cycle must repeat at least this many times to be a loop. */
export const LOOP_MIN_REPEATS = 3
/** Longest cycle length we look for, in tool calls. */
export const LOOP_MAX_PERIOD = 5
/** …and it only counts as *stuck* if nothing landed in this long. */
export const LOOP_NO_PROGRESS_MS = 3 * 60_000
/** EXPENSIVE = this many times the fleet's median output rate… */
export const EXPENSIVE_MULTIPLE = 3
/** …and at least this many output tokens/min, so a quiet fleet has no outlier. */
export const EXPENSIVE_FLOOR_PER_MIN = 120

// ── the ladder (ruling 8) ───────────────────────────────────────────────────

export type Rung = 'calm' | 'notice' | 'needs' | 'broken'

export const RUNG_ORDER: Record<Rung, number> = { calm: 0, notice: 1, needs: 2, broken: 3 }

export type Pathology = 'looping' | 'frozen' | 'waiting' | 'expensive' | 'off-fence'

/** Which rung each pathology climbs to. A lane takes the worst it has. */
export const PATHOLOGY_RUNG: Record<Pathology, Rung> = {
  looping: 'needs',
  waiting: 'needs',
  frozen: 'broken',
  'off-fence': 'broken',
  expensive: 'notice',
}

export const PATHOLOGY_WORD: Record<Pathology, string> = {
  looping: 'LOOPING',
  frozen: 'FROZEN',
  waiting: 'WAITING',
  expensive: 'EXPENSIVE',
  'off-fence': 'OFF-FENCE',
}

// ── shapes ──────────────────────────────────────────────────────────────────

/** `.swarm/lanes.json` (ruling 19): handle → fence globs → issue → model. */
export interface LaneManifestEntry {
  handle: string
  fence: string[]
  issue: string | null
  model: string | null
}

export type LaneManifest = Record<string, LaneManifestEntry>

export interface LaneVital {
  /** Worktree path when there is one, else the telemetry lane handle. */
  id: string
  handle: string
  branch: string | null
  worktreePath: string | null
  issue: string | null
  isMain: boolean
  /** True when this row exists only because telemetry named it (no worktree). */
  telemetryOnly: boolean

  // work
  outputTokens: number
  totalTokens: number
  costUsd: number
  costAuthoritative: boolean | null
  /** Output tokens per minute over the trailing window. */
  outputPerMin: number
  costPerHour: number
  requestCount: number
  toolCallCount: number
  subagentOutputTokens: number
  subagentCount: number

  // place
  aheadOfMain: number
  dirtyFiles: number
  commits: number
  filesTouched: number

  // liveness
  lastActivityTs: number | null
  ageMs: number | null
  /** 1 = this second, 0 = cold. The recency ramp every visual uses. */
  freshness: number
  agentStatus: AgentStatus | null
  /**
   * How long the lane has held its current workmux status. A poll re-reports
   * `waiting` every minute, so `updatedAt` is recent while the *transition* is
   * not — and "waiting 6m" is the number the operator needs.
   */
  statusSinceMs: number | null

  // fence
  fence: string[] | null
  offFenceFiles: string[]

  // classification
  pathologies: Pathology[]
  rung: Rung
  /** Terse "why" for the attention strip, e.g. `Read→Edit→Bash ×5`. */
  reason: string | null
  /** How long the condition has held; null when there is no condition. */
  sinceMs: number | null
  /**
   * True when WAITING was inferred from pane state rather than declared by
   * workmux. Ruling 18's detection-honesty clause — rendered with a `?`.
   */
  waitingInferred: boolean
  recentTools: string[]
  /** Timestamps parallel to {@link recentTools} — how long the loop has run. */
  recentToolTs: number[]
}

export interface BurnTotals {
  outputTokens: number
  costUsd: number
  costAuthoritative: boolean | null
  costEventCount: number
  outputPerMin: number
  costPerHour: number
  overheadRatio: number | null
  conductorInstrumented: boolean
}

export interface Evidence {
  laneCount: number
  fencedLaneCount: number
  branchesChecked: number
  filesChecked: number
  /** Files more than one branch has its hands on. */
  collisionFiles: number
  /** Branch-vs-branch pairs behind those files. */
  collisionPairs: number
  newestEventAgeMs: number | null
  eventCount: number
}

export interface Gap {
  what: string
  why: string
  fix: string
}

export interface Fleet {
  repoName: string | null
  mainBranch: string | null
  main: LaneVital | null
  lanes: LaneVital[]
  attention: LaneVital[]
  rung: Rung
  burn: BurnTotals
  evidence: Evidence
  gaps: Gap[]
  now: number
}

export interface BuildFleetOptions {
  now: number
  manifest?: LaneManifest | null
  windowMs?: number
}

// ── the build ───────────────────────────────────────────────────────────────

export function buildFleet(
  events: readonly ObservatoryEvent[],
  { now, manifest = null, windowMs = DEFAULT_SPEND_WINDOW_MS }: BuildFleetOptions,
): Fleet {
  const state = reduceAll(events)

  // Token authority: sessionlog when it is reporting (it is the one with cache
  // tiers), otherwise OTel. Never both — that would double-count (spend.ts §2).
  const tokenOrigins: TelemetryOrigin[] = state.telemetry.usage.some(
    (record) => record.origin === 'sessionlog',
  )
    ? ['sessionlog']
    : ['otel']

  const tokenSpend = index(selectLaneSpend(state, { origins: tokenOrigins }))
  // Dollars only ever ride on `llm.cost`, so an unfiltered pass cannot double
  // them — and filtering to the token origin would throw OTel's dollars away.
  const costSpend = index(selectLaneSpend(state))
  const rates = selectSpendRateByLane(state, { now, windowMs, origins: tokenOrigins })
  // Dollars need their own pass: the origins filter applies to cost records too,
  // and every dollar rides on an OTel `llm.cost` the token filter would drop.
  const costRates = selectSpendRateByLane(state, { now, windowMs })
  const touches = selectTouchesByBranch(state)
  const worktrees = selectWorktreeViews(state)
  const minutes = windowMs / 60_000

  const toolsByLane = groupRecentTools(state)
  const subagents = groupSubagents(state)
  const lastTelemetryTs = groupLastTelemetryTs(state)
  const statusSince = agentStatusSince(events)

  // Which telemetry lane handles belong to which worktree, so a worktree row
  // can claim its spend and a lane with no worktree can still get a row.
  const claimed = new Set<string>()
  const laneKeysFor = (worktreePath: string, branch: string | null, name: string): string[] => {
    const keys: string[] = []
    for (const attribution of Object.values(state.telemetry.lanes)) {
      const matches =
        attribution.worktreePath === worktreePath ||
        (branch !== null && attribution.branch === branch) ||
        attribution.lane === name ||
        (branch !== null && attribution.lane === branch)
      if (matches) keys.push(attribution.lane)
    }
    return keys
  }

  const drafts: LaneVital[] = []

  for (const view of worktrees) {
    const keys = laneKeysFor(view.path, view.branch, view.name)
    for (const key of keys) claimed.add(key)

    const handle = view.branch ?? view.name
    const entry = manifestFor(manifest, [handle, view.name, view.branch])
    const files = [
      ...(view.branch === null ? [] : (touches[view.branch] ?? []).map((t) => t.path)),
      ...view.dirtyFiles.map((f) => f.path),
    ]

    drafts.push(
      draft({
        id: view.path,
        handle,
        branch: view.branch,
        worktreePath: view.path,
        isMain: view.isMain,
        telemetryOnly: false,
        keys,
        entry,
        files: unique(files),
        aheadOfMain: view.aheadOfMain,
        dirtyFiles: view.dirtyCount,
        commits: view.branch === null ? 0 : (state.branches[view.branch]?.commits.length ?? 0),
        filesTouched: view.filesTouched.length,
        agentStatus: view.agent?.status ?? null,
        agentTs: view.agent?.updatedAt ?? null,
        statusSinceTs:
          view.agent === null || view.agent === undefined
            ? null
            : (statusSince[view.agent.handle]?.since ?? view.agent.updatedAt),
        paneActivityTs: view.lastActivityTs,
        dirtyTs: state.worktrees[view.path]?.dirtyUpdatedAt ?? null,
      }),
    )
  }

  // Telemetry lanes with no worktree of their own — the conductor, an
  // unattributed OTel stream. They are real spend and must stay visible.
  for (const attribution of Object.values(state.telemetry.lanes)) {
    if (claimed.has(attribution.lane)) continue
    const entry = manifestFor(manifest, [attribution.lane])
    drafts.push(
      draft({
        id: `lane:${attribution.lane}`,
        handle: attribution.lane,
        branch: attribution.branch,
        worktreePath: attribution.worktreePath,
        isMain: false,
        telemetryOnly: true,
        keys: [attribution.lane],
        entry,
        files: [],
        aheadOfMain: 0,
        dirtyFiles: 0,
        commits: 0,
        filesTouched: 0,
        agentStatus: null,
        agentTs: null,
        statusSinceTs: null,
        paneActivityTs: null,
        dirtyTs: null,
      }),
    )
  }

  function draft(seed: {
    id: string
    handle: string
    branch: string | null
    worktreePath: string | null
    isMain: boolean
    telemetryOnly: boolean
    keys: string[]
    entry: LaneManifestEntry | null
    files: string[]
    aheadOfMain: number
    dirtyFiles: number
    commits: number
    filesTouched: number
    agentStatus: AgentStatus | null
    agentTs: number | null
    statusSinceTs: number | null
    paneActivityTs: number | null
    dirtyTs: number | null
  }): LaneVital {
    let outputTokens = 0
    let totalTokens = 0
    let costUsd = 0
    let costEvents = 0
    let authoritativeEvents = 0
    let requestCount = 0
    let toolCallCount = 0
    let outputPerMin = 0
    let costPerHour = 0
    let subagentOutput = 0
    let telemetryTs: number | null = null
    const tools: { tool: string; ts: number }[] = []
    const subagentIds = new Set<string>()

    for (const key of seed.keys) {
      const tokens = tokenSpend[key]
      if (tokens) {
        outputTokens += tokens.tokens.output
        totalTokens += tokens.tokens.total
        requestCount += tokens.requestCount
        toolCallCount += tokens.toolCallCount
        for (const thread of tokens.threads) {
          if (thread.thread === 'subagent') subagentOutput += thread.tokens.output
        }
      }
      const cost = costSpend[key]
      if (cost) {
        costUsd += cost.costUsd
        costEvents += cost.costEventCount
        authoritativeEvents += cost.costEventCount - cost.estimatedCostEventCount
      }
      const rate = rates[key]
      if (rate) outputPerMin += rate.totals.tokens.output / minutes
      const costRate = costRates[key]
      if (costRate) costPerHour += costRate.costUsdPerHour
      tools.push(...(toolsByLane[key] ?? []))
      for (const id of subagents[key] ?? []) subagentIds.add(id)
      const ts = lastTelemetryTs[key]
      if (ts !== undefined && (telemetryTs === null || ts > telemetryTs)) telemetryTs = ts
    }

    // Two collectors can name the same lane, so merge on time before the loop
    // detector reads the sequence — an interleaved tail is not a cycle.
    tools.sort((a, b) => a.ts - b.ts)
    const recent = tools.slice(-24)

    const lastActivityTs = maxOrNull([
      seed.paneActivityTs,
      seed.agentTs,
      seed.dirtyTs,
      telemetryTs,
      lastCommitTs(state, seed.branch),
    ])

    const fence = seed.entry?.fence ?? null
    const offFenceFiles =
      fence === null ? [] : seed.files.filter((file) => !fence.some((glob) => globMatch(glob, file)))

    return {
      id: seed.id,
      handle: seed.handle,
      branch: seed.branch,
      worktreePath: seed.worktreePath,
      issue: seed.entry?.issue ?? issueFrom(seed.handle),
      isMain: seed.isMain,
      telemetryOnly: seed.telemetryOnly,
      outputTokens,
      totalTokens,
      costUsd,
      costAuthoritative: costEvents === 0 ? null : authoritativeEvents === costEvents,
      outputPerMin,
      costPerHour,
      requestCount,
      toolCallCount,
      subagentOutputTokens: subagentOutput,
      subagentCount: subagentIds.size,
      aheadOfMain: seed.aheadOfMain,
      dirtyFiles: seed.dirtyFiles,
      commits: seed.commits,
      filesTouched: seed.filesTouched,
      lastActivityTs,
      ageMs: lastActivityTs === null ? null : Math.max(0, now - lastActivityTs),
      freshness: freshnessOf(lastActivityTs, now),
      agentStatus: seed.agentStatus,
      statusSinceMs: seed.statusSinceTs === null ? null : Math.max(0, now - seed.statusSinceTs),
      fence,
      offFenceFiles,
      pathologies: [],
      rung: 'calm',
      reason: null,
      sinceMs: null,
      waitingInferred: false,
      recentTools: recent.map((entry) => entry.tool),
      recentToolTs: recent.map((entry) => entry.ts),
    }
  }

  // ── classify, now that the fleet exists (EXPENSIVE is relative) ───────────

  const workers = drafts.filter((lane) => !lane.isMain)
  const medianRate = median(workers.map((lane) => lane.outputPerMin).filter((rate) => rate > 0))
  const expensiveThreshold = Math.max(medianRate * EXPENSIVE_MULTIPLE, EXPENSIVE_FLOOR_PER_MIN)

  for (const lane of drafts) classify(lane, { now, state, expensiveThreshold })

  const main = drafts.find((lane) => lane.isMain) ?? null
  const lanes = drafts
    .filter((lane) => !lane.isMain)
    .sort(
      (a, b) =>
        RUNG_ORDER[b.rung] - RUNG_ORDER[a.rung] ||
        b.outputTokens - a.outputTokens ||
        compare(a.handle, b.handle),
    )

  const attention = lanes
    .filter((lane) => lane.rung === 'needs' || lane.rung === 'broken')
    .sort((a, b) => RUNG_ORDER[b.rung] - RUNG_ORDER[a.rung] || (b.sinceMs ?? 0) - (a.sinceMs ?? 0))

  const evidence = evidenceOf(state, lanes, now)

  // Ruling 14: a real collision is a ladder item. ALL CLEAR may never be
  // printed next to a non-zero collision count — that is the contradiction
  // the evidence rule exists to prevent.
  const floor: Rung =
    lanes.some((lane) => lane.rung === 'notice') || evidence.collisionFiles > 0
      ? 'notice'
      : 'calm'

  const rung: Rung = attention.reduce<Rung>(
    (worst, lane) => (RUNG_ORDER[lane.rung] > RUNG_ORDER[worst] ? lane.rung : worst),
    floor,
  )

  return {
    repoName: state.session?.repoName ?? null,
    mainBranch: state.mainBranch,
    main,
    lanes,
    attention,
    rung,
    burn: burnOf(state, { now, windowMs, tokenOrigins }),
    evidence,
    gaps: gapsOf(state, lanes, manifest),
    now,
  }
}

// ── the five detectors ──────────────────────────────────────────────────────

function classify(
  lane: LaneVital,
  ctx: { now: number; state: SessionState; expensiveThreshold: number },
): void {
  const found: Pathology[] = []
  const reasons: string[] = []
  let since: number | null = null

  // WAITING — stopped with a hand raised. Declared by workmux, so it is a fact,
  // not an inference; `waitingInferred` stays false. Checked first because a
  // lane that is *deliberately* stopped is not frozen.
  if (lane.agentStatus === 'waiting') {
    found.push('waiting')
    reasons.push('hand raised')
    since = lane.statusSinceMs ?? lane.ageMs
  }

  // FROZEN — dead air. Never both frozen and waiting: a raised hand is a live
  // signal, silence is the absence of one.
  const dead = lane.ageMs !== null && lane.ageMs >= FROZEN_MS
  if (dead && lane.agentStatus !== 'waiting' && lane.agentStatus !== 'done' && !lane.telemetryOnly) {
    found.push('frozen')
    reasons.push('no events')
    since = lane.ageMs
  }

  // LOOPING — a repeating tool-call cycle with nothing landing behind it.
  const cycle = detectCycle(lane.recentTools)
  const stalled =
    lastCommitTs(ctx.state, lane.branch) === null ||
    ctx.now - (lastCommitTs(ctx.state, lane.branch) ?? 0) >= LOOP_NO_PROGRESS_MS
  if (cycle !== null && stalled && !dead) {
    found.push('looping')
    reasons.push(`${cycle.cycle.join('→')} ×${cycle.repeats}`)
    // How long it has been going round: the timestamp of the first call in the
    // repeated run, not "when we last heard from it".
    const runStart = lane.recentToolTs[lane.recentToolTs.length - cycle.cycle.length * cycle.repeats]
    since ??= runStart === undefined ? lane.ageMs : Math.max(0, ctx.now - runStart)
  }

  // EXPENSIVE — a burn outlier against the fleet median (spend selectors).
  if (lane.outputPerMin >= ctx.expensiveThreshold && lane.outputPerMin > 0) {
    found.push('expensive')
    reasons.push(`${Math.round(lane.outputPerMin)} out/min`)
  }

  // OFF-FENCE — touching files outside the fence its dispatch declared.
  if (lane.offFenceFiles.length > 0) {
    found.push('off-fence')
    reasons.push(`${lane.offFenceFiles.length} file${lane.offFenceFiles.length === 1 ? '' : 's'} outside fence`)
  }

  lane.pathologies = found
  lane.rung = found.reduce<Rung>(
    (worst, pathology) =>
      RUNG_ORDER[PATHOLOGY_RUNG[pathology]] > RUNG_ORDER[worst] ? PATHOLOGY_RUNG[pathology] : worst,
    'calm',
  )
  lane.reason = reasons.length === 0 ? null : reasons.join(' · ')
  lane.sinceMs = since
}

/**
 * The loop detector: does the tail of this lane's tool-call sequence consist of
 * one short cycle repeated? Returns the longest cycle that repeats at least
 * {@link LOOP_MIN_REPEATS} times, so `Read→Edit→Bash ×5` is reported as a
 * three-step loop rather than as a one-step `Bash` loop.
 */
export function detectCycle(
  tools: readonly string[],
): { cycle: string[]; repeats: number } | null {
  let best: { cycle: string[]; repeats: number } | null = null

  for (let period = 1; period <= LOOP_MAX_PERIOD; period += 1) {
    if (tools.length < period * LOOP_MIN_REPEATS) break
    const cycle = tools.slice(tools.length - period)

    let repeats = 0
    for (let start = tools.length - period; start >= 0; start -= period) {
      const window = tools.slice(start, start + period)
      if (!window.every((tool, index) => tool === cycle[index])) break
      repeats += 1
    }

    // A single tool called N times in a row is a loop too, but a longer cycle
    // that covers the same tail is the more informative answer.
    if (repeats >= LOOP_MIN_REPEATS && (best === null || period > best.cycle.length)) {
      best = { cycle, repeats }
    }
  }

  return best
}

/** `packages/web/**` / `docs/*.md` / `README.md`. No brace or negation syntax. */
export function globMatch(glob: string, path: string): boolean {
  const pattern = glob
    .split(/(\*\*\/|\*\*|\*|\?|\.)/)
    .map((part) => {
      if (part === '**/') return '(?:.*/)?'
      if (part === '**') return '.*'
      if (part === '*') return '[^/]*'
      if (part === '?') return '[^/]'
      if (part === '.') return '\\.'
      return part.replace(/[\\^$+(){}[\]|]/g, '\\$&')
    })
    .join('')
  return new RegExp(`^${pattern}$`).test(path)
}

// ── burn strip + evidence + gaps ────────────────────────────────────────────

function burnOf(
  state: SessionState,
  ctx: { now: number; windowMs: number; tokenOrigins: TelemetryOrigin[] },
): BurnTotals {
  const lanes = selectLaneSpend(state, { origins: ctx.tokenOrigins })
  const costs = selectLaneSpend(state)
  const rates = selectSpendRateByLane(state, {
    now: ctx.now,
    windowMs: ctx.windowMs,
    origins: ctx.tokenOrigins,
  })
  const costRates = selectSpendRateByLane(state, { now: ctx.now, windowMs: ctx.windowMs })
  const minutes = ctx.windowMs / 60_000

  const outputTokens = lanes.reduce((sum, lane) => sum + lane.tokens.output, 0)
  const costUsd = costs.reduce((sum, lane) => sum + lane.costUsd, 0)
  const costEventCount = costs.reduce((sum, lane) => sum + lane.costEventCount, 0)
  const estimated = costs.reduce((sum, lane) => sum + lane.estimatedCostEventCount, 0)
  const outputPerMin = Object.values(rates).reduce(
    (sum, rate) => sum + rate.totals.tokens.output / minutes,
    0,
  )
  const costPerHour = Object.values(costRates).reduce((sum, rate) => sum + rate.costUsdPerHour, 0)

  return {
    outputTokens,
    costUsd,
    costAuthoritative: costEventCount === 0 ? null : estimated === 0,
    costEventCount,
    outputPerMin,
    costPerHour,
    overheadRatio: selectOverheadRatio(state, { origins: ctx.tokenOrigins }),
    conductorInstrumented: state.telemetry.usage.some((record) => record.role === 'conductor'),
  }
}

/**
 * Ruling 14: never bare reassurance. ALL CLEAR has to say what was checked.
 */
function evidenceOf(state: SessionState, lanes: LaneVital[], now: number): Evidence {
  const files = new Set<string>()
  const touches = selectTouchesByBranch(state)
  for (const list of Object.values(touches)) for (const touch of list) files.add(touch.path)

  return {
    laneCount: lanes.length,
    fencedLaneCount: lanes.filter((lane) => lane.fence !== null).length,
    branchesChecked: Object.keys(touches).length,
    filesChecked: files.size,
    collisionFiles: selectCollisions(state).length,
    collisionPairs: selectCollisionPairs(state).length,
    newestEventAgeMs: state.lastEventTs === null ? null : Math.max(0, now - state.lastEventTs),
    eventCount: state.eventCount,
  }
}

/** Law 12: WHAT is missing → WHY it matters → THE command that fixes it. */
function gapsOf(state: SessionState, lanes: LaneVital[], manifest: LaneManifest | null): Gap[] {
  const gaps: Gap[] = []

  if (!state.telemetry.costs.some((record) => record.authoritative)) {
    gaps.push({
      what: 'NO COST FEED (OTel)',
      why: 'dollars unavailable',
      fix: 'eval "$(observatory env <lane>)"',
    })
  }

  const unfenced = lanes.filter((lane) => lane.fence === null && !lane.telemetryOnly)
  if (manifest === null || unfenced.length > 0) {
    gaps.push({
      what: `NO LANE FENCE${manifest === null ? '' : ` (${unfenced.length}/${lanes.length})`}`,
      why: 'off-fence undetectable',
      fix: 'dispatch.sh writes .swarm/lanes.json',
    })
  }

  if (!state.telemetry.usage.some((record) => record.role === 'conductor')) {
    gaps.push({
      what: 'CONDUCTOR NOT INSTRUMENTED',
      why: 'overhead ratio unknowable',
      fix: 'observatory --extra-sessions <dir>:conductor',
    })
  }

  for (const collector of Object.values(state.collectors)) {
    gaps.push({
      what: `${collector.name.toUpperCase()} COLLECTOR ${collector.status.toUpperCase()}`,
      why: collector.lastErrorMessage ?? collector.disabledReason ?? 'feed missing',
      fix: 'observatory doctor',
    })
  }

  return gaps
}

// ── small helpers ───────────────────────────────────────────────────────────

function index(lanes: LaneSpend[]): Record<string, LaneSpend> {
  const map: Record<string, LaneSpend> = {}
  for (const lane of lanes) map[lane.lane] = lane
  return map
}

/**
 * When each agent handle *entered* the status it is currently in — read off the
 * raw log rather than off `AgentState.updatedAt`, which a poll keeps bumping.
 */
function agentStatusSince(
  events: readonly ObservatoryEvent[],
): Record<string, { status: AgentStatus; since: number }> {
  const map: Record<string, { status: AgentStatus; since: number }> = {}
  for (const event of events) {
    if (event.type !== 'agent.status') continue
    const seen = map[event.payload.handle]
    if (seen === undefined || seen.status !== event.payload.status) {
      map[event.payload.handle] = { status: event.payload.status, since: event.ts }
    }
  }
  return map
}

function groupRecentTools(state: SessionState): Record<string, { tool: string; ts: number }[]> {
  const map: Record<string, { tool: string; ts: number }[]> = {}
  for (const record of state.telemetry.tools) {
    ;(map[record.lane] ??= []).push({ tool: record.tool, ts: record.ts })
  }
  return map
}

function groupSubagents(state: SessionState): Record<string, Set<string>> {
  const map: Record<string, Set<string>> = {}
  for (const record of state.telemetry.usage) {
    if (record.thread !== 'subagent') continue
    ;(map[record.lane] ??= new Set()).add(record.requestId ?? record.sessionId ?? record.eventId)
  }
  return map
}

function groupLastTelemetryTs(state: SessionState): Record<string, number> {
  const map: Record<string, number> = {}
  const note = (lane: string, ts: number) => {
    const seen = map[lane]
    if (seen === undefined || ts > seen) map[lane] = ts
  }
  for (const record of state.telemetry.usage) note(record.lane, record.ts)
  for (const record of state.telemetry.tools) note(record.lane, record.ts)
  for (const record of state.telemetry.costs) note(record.lane, record.ts)
  return map
}

function lastCommitTs(state: SessionState, branch: string | null): number | null {
  if (branch === null) return null
  const shas = state.branches[branch]?.commits ?? []
  let latest: number | null = null
  for (const sha of shas) {
    const commit = state.commits[sha]
    if (commit === undefined) continue
    if (latest === null || commit.landedAt > latest) latest = commit.landedAt
  }
  return latest
}

/** 1 → this second, 0 → {@link COLD_MS} of silence. Eased so fresh reads fresh. */
export function freshnessOf(lastActivityTs: number | null, now: number): number {
  if (lastActivityTs === null) return 0
  const age = Math.max(0, now - lastActivityTs)
  const linear = Math.max(0, 1 - age / COLD_MS)
  return linear ** 0.6
}

function manifestFor(
  manifest: LaneManifest | null,
  keys: (string | null)[],
): LaneManifestEntry | null {
  if (manifest === null) return null
  for (const key of keys) {
    if (key !== null && manifest[key] !== undefined) return manifest[key]
  }
  return null
}

function issueFrom(handle: string): string | null {
  const match = /^(\d+)[-_]/.exec(handle)
  return match?.[1] ?? null
}

function maxOrNull(values: (number | null)[]): number | null {
  let best: number | null = null
  for (const value of values) {
    if (value === null) continue
    if (best === null || value > best) best = value
  }
  return best
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
