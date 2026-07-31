import {
  DEFAULT_SPEND_WINDOW_MS,
  selectCollisions,
  selectLaneSpend,
  selectRoleSpend,
  selectSessionSpend,
  selectSpendRate,
  selectSpendRateByLane,
  selectTouchesByBranch,
  selectWorktreeViews,
  type AgentRole,
  type AgentStatus,
  type AgentThread,
  type LaneSpend,
  type SessionState,
  type SpendRate,
  type SpendTotals,
  type TokenTotals,
} from '@observatory/core'
import { findTrespasses, type LaneManifest, type Trespass } from './fences.js'

/**
 * One read of the log for the whole page: the scene, the attention strip, the
 * burn strip and the fleet table are four views of *this* object, so they can
 * never disagree about how many lanes are working or which one is looping.
 *
 * Everything here is derived by core's selectors over the same `SessionState`
 * the rest of the app folds. Nothing is summed locally, and nothing that the
 * log did not say is invented — the pathology detectors below each name the
 * recorded facts they read and mark themselves `inferred` when they had to
 * lean on a weaker signal (prd3 ruling 18's detection-honesty clause).
 */

// --- thresholds --------------------------------------------------------------

/** Tokens are taken from the collector with cache-tier detail; dollars from the one with authority. */
const TOKEN_ORIGINS = ['sessionlog'] as const

/** How far back the loop detector looks for a repeating tool cycle. */
export const LOOP_WINDOW_MS = 4 * 60_000
/** Shortest cycle length worth calling a loop, and how many repeats it takes. */
const LOOP_MIN_PERIOD = 2
const LOOP_MAX_PERIOD = 6
const LOOP_MIN_REPEATS = 3

/** Silence longer than this, with nobody saying "done", is a flatline. */
export const FROZEN_AFTER_MS = 8 * 60_000
/** Silence longer than this, with the pane still alive, smells like a raised hand. */
const WAITING_QUIET_MS = 75_000
/** How recently a pane must have moved for "waiting" to be inferable from it. */
const WAITING_PANE_FRESH_MS = 45_000

/** A lane burning this many times the fleet median is an outlier. */
const EXPENSIVE_MULTIPLE = 3
/** …but only once it is burning enough to be worth a word. */
const EXPENSIVE_FLOOR_PER_MIN = 300

/** Beyond this a calm lane has simply gone quiet — not broken, just cold. */
export const QUIET_AFTER_MS = 90_000

// --- shapes ------------------------------------------------------------------

export type LadderRank = 'calm' | 'notice' | 'needs-you' | 'broken'

export const LADDER_ORDER: readonly LadderRank[] = ['calm', 'notice', 'needs-you', 'broken']

export function worseRank(a: LadderRank, b: LadderRank): LadderRank {
  return LADDER_ORDER.indexOf(a) >= LADDER_ORDER.indexOf(b) ? a : b
}

export type PathologyKind = 'looping' | 'frozen' | 'waiting' | 'expensive' | 'off-fence'

export interface Pathology {
  kind: PathologyKind
  rank: LadderRank
  /** When the condition started, as best the log can say. Null when unknown. */
  since: number | null
  /** One terse clause naming the evidence, e.g. `Read→Edit→Bash ×4, no commit`. */
  evidence: string
  /** True when a weaker signal (pane state) was needed to reach this call. */
  inferred: boolean
  /** For off-fence: the lane whose fence was crossed, when exactly one was. */
  victim?: string | null
}

export const PATHOLOGY_RANK: Record<PathologyKind, LadderRank> = {
  frozen: 'broken',
  looping: 'needs-you',
  waiting: 'needs-you',
  'off-fence': 'needs-you',
  expensive: 'notice',
}

/** How a lane is getting on, when nothing is wrong with it. */
export type LaneActivity = 'working' | 'waiting' | 'done' | 'quiet' | 'unknown'

/** A subagent (or auxiliary) thread of a lane — the scene's second-growth filaments. */
export interface Filament {
  thread: AgentThread | null
  outputTokens: number
  requestCount: number
}

export interface Lane {
  /** Stable key: the branch when known, else the telemetry handle. */
  id: string
  label: string
  handle: string | null
  branch: string | null
  worktreePath: string | null
  role: AgentRole
  present: boolean
  agentStatus: AgentStatus | null
  activity: LaneActivity

  outputTokens: number
  totalTokens: number
  cacheReadTokens: number
  /** All four tiers, so the breakdown is always reachable from the headline. */
  tokens: TokenTotals
  costUsd: number
  costIsAuthoritative: boolean | null
  costEventCount: number
  requestCount: number
  toolCallCount: number
  /** Output tokens per minute over the trailing window — the burn outlier test. */
  outputPerMin: number

  commitCount: number
  aheadOfMain: number
  dirtyCount: number
  filesTouched: number

  /** Newest fact of any kind about this lane. Null when the log has none. */
  lastEventTs: number | null
  ageMs: number | null
  firstSeenAt: number

  filaments: Filament[]
  /** Tool names in the trailing loop window, oldest first — the loop evidence. */
  recentTools: string[]
  pathologies: Pathology[]
  trespasses: Trespass[]
  rank: LadderRank
  fenceIssue: string | null
  model: string | null
}

/** Main — the root-mass. Its own burn is the conductor's, not a worker lane's. */
export interface RootMass {
  repoName: string | null
  mainBranch: string | null
  worktreePath: string | null
  /** Commits observed landing on main — the surges into the root-mass. */
  commitsHome: number
  /** Worktrees that have gone away: a lane that landed and folded. */
  landings: number
  conductorOutputTokens: number
  overheadRatio: number | null
  lastCommitTs: number | null
}

export interface AttentionItem {
  /** Unique per item — two collisions can share a lane, so the lane id is not. */
  id: string
  laneId: string
  label: string
  kind: PathologyKind | 'collision' | 'collector'
  rank: LadderRank
  /** How long it has been true, in ms. Null when the log cannot say. */
  forMs: number | null
  evidence: string
  inferred: boolean
}

export interface Evidence {
  lanes: number
  working: number
  commitsHome: number
  branchesChecked: number
  filesChecked: number
  collisions: number
}

/** One terse WHAT → WHY → COMMAND line, per prd3 ruling 12. */
export interface Gap {
  what: string
  why: string
  command: string
}

export interface Fleet {
  now: number
  root: RootMass
  lanes: Lane[]
  rank: LadderRank
  attention: AttentionItem[]
  evidence: Evidence
  gaps: Gap[]
  /** Session-wide burn — the burn strip's four numbers. */
  totals: SpendTotals
  tokenTotals: SpendTotals
  rate: SpendRate
  outputPerMin: number
  overheadRatio: number | null
  hasFenceManifest: boolean
  eventCount: number
}

export interface BuildFleetOptions {
  now: number
  manifest?: LaneManifest | null
  windowMs?: number
}

// --- the build ---------------------------------------------------------------

export function buildFleet(state: SessionState, options: BuildFleetOptions): Fleet {
  const { now } = options
  const windowMs = options.windowMs ?? DEFAULT_SPEND_WINDOW_MS
  const manifest = options.manifest ?? null

  // Tokens and dollars come from different collectors on purpose: sessionlog is
  // the only one with cache-tier detail, otel the only one with real dollars.
  // Two passes rather than one mixed pass, so neither number double-counts.
  const tokenTotals = selectSessionSpend(state, { origins: TOKEN_ORIGINS })
  const totals = selectSessionSpend(state)
  const rate = selectSpendRate(state, { now, windowMs })
  const tokenRateByLane = selectSpendRateByLane(state, { now, windowMs, origins: TOKEN_ORIGINS })
  const tokenSpendByLane = index(selectLaneSpend(state, { origins: TOKEN_ORIGINS }))
  const costSpendByLane = index(selectLaneSpend(state))
  const roleSplit = selectRoleSpend(state, { origins: TOKEN_ORIGINS })

  const worktrees = selectWorktreeViews(state, { includeRemoved: true })
  const touches = selectTouchesByBranch(state)
  const collisions = selectCollisions(state)
  const toolsByLane = recentToolsByLane(state, now - LOOP_WINDOW_MS)
  const commitTsByBranch = latestCommitTsByBranch(state)

  const main = worktrees.find((view) => view.isMain) ?? null
  const mainBranch = state.mainBranch ?? main?.branch ?? null

  // --- assemble lanes, joining git geography to telemetry identity ----------
  const drafts = new Map<string, Draft>()

  const draftFor = (key: string, seedTs: number): Draft => {
    const existing = drafts.get(key)
    if (existing !== undefined) return existing
    const created = emptyDraft(key, seedTs)
    drafts.set(key, created)
    return created
  }

  for (const view of worktrees) {
    if (view.isMain) continue
    const key = view.branch ?? view.path
    const draft = draftFor(key, view.discoveredAt)
    draft.label = view.branch ?? view.name
    draft.branch = view.branch
    draft.worktreePath = view.path
    draft.present = view.present
    draft.agentStatus = view.agent?.status ?? null
    draft.agentStatusTs = view.agent?.updatedAt ?? null
    draft.aheadOfMain = view.aheadOfMain
    draft.dirtyCount = view.dirtyCount
    draft.filesTouched = view.filesTouched.length
    draft.commitCount = view.branch === null ? 0 : (state.branches[view.branch]?.commits.length ?? 0)
    draft.paneActivityTs = view.lastActivityTs
    draft.lastEventTs = maxTs(
      draft.lastEventTs,
      view.lastActivityTs,
      view.agent?.updatedAt ?? null,
      state.worktrees[view.path]?.dirtyUpdatedAt ?? null,
      view.branch === null ? null : (commitTsByBranch.get(view.branch) ?? null),
    )
  }

  // A worktree the git collector never saw still gets a thread if telemetry
  // named it: unattributed and orphan spend must stay visible, never dropped.
  let conductorOutputTokens = 0
  for (const spend of Object.values(tokenSpendByLane)) {
    const role = dominantRole(spend.roles)
    if (role === 'conductor') {
      conductorOutputTokens += spend.tokens.output
      continue
    }
    const key = spend.branch ?? spend.lane
    if (mainBranch !== null && key === mainBranch) {
      // Spend booked against main itself is the root-mass's, not a lane's.
      conductorOutputTokens += spend.tokens.output
      continue
    }
    const draft = draftFor(key, state.telemetry.lanes[spend.lane]?.firstSeenAt ?? spend.firstTs ?? now)
    draft.handle = spend.lane
    draft.role = role
    if (draft.branch === null) draft.branch = spend.branch
    if (draft.worktreePath === null) draft.worktreePath = spend.worktreePath
  }

  // --- fill the numbers, then diagnose -------------------------------------
  const lanes: Lane[] = []
  for (const draft of drafts.values()) {
    const handles = handlesFor(draft, tokenSpendByLane)
    const tokenSpend = mergeSpend(handles.map((handle) => tokenSpendByLane[handle]))
    const costSpend = mergeSpend(handles.map((handle) => costSpendByLane[handle]))
    const outputPerMin = handles.reduce(
      (sum, handle) => sum + outputPerMinute(tokenRateByLane[handle], windowMs),
      0,
    )

    const lastEventTs = maxTs(draft.lastEventTs, tokenSpend?.lastTs ?? null, costSpend?.lastTs ?? null)
    const recentTools = handles.flatMap((handle) => toolsByLane.get(handle) ?? [])

    lanes.push({
      id: draft.id,
      label: draft.label,
      handle: draft.handle,
      branch: draft.branch,
      worktreePath: draft.worktreePath,
      role: draft.role,
      present: draft.present,
      agentStatus: draft.agentStatus,
      activity: 'unknown',

      outputTokens: tokenSpend?.tokens.output ?? 0,
      totalTokens: tokenSpend?.tokens.total ?? 0,
      cacheReadTokens: tokenSpend?.tokens.cacheRead ?? 0,
      tokens: tokenSpend?.tokens ?? ZERO_TIERS,
      costUsd: costSpend?.costUsd ?? 0,
      costIsAuthoritative: costSpend?.costIsAuthoritative ?? null,
      costEventCount: costSpend?.costEventCount ?? 0,
      requestCount: tokenSpend?.requestCount ?? 0,
      toolCallCount: tokenSpend?.toolCallCount ?? 0,
      outputPerMin,

      commitCount: draft.commitCount,
      aheadOfMain: draft.aheadOfMain,
      dirtyCount: draft.dirtyCount,
      filesTouched: draft.filesTouched,

      lastEventTs,
      ageMs: lastEventTs === null ? null : Math.max(0, now - lastEventTs),
      firstSeenAt: draft.firstSeenAt,

      filaments: filamentsOf(tokenSpend),
      recentTools,
      pathologies: [],
      trespasses: [],
      rank: 'calm',
      fenceIssue: manifest?.[draft.handle ?? draft.id]?.issue ?? null,
      model: manifest?.[draft.handle ?? draft.id]?.model ?? null,
    })
  }

  const medianOutputPerMin = median(lanes.map((lane) => lane.outputPerMin).filter((v) => v > 0))

  for (const lane of lanes) {
    lane.pathologies = diagnose(lane, {
      now,
      medianOutputPerMin,
      manifest,
      touched: lane.branch === null ? [] : (touches[lane.branch] ?? []).map((t) => t.path),
      paneActivityTs: drafts.get(lane.id)?.paneActivityTs ?? null,
      agentStatusTs: drafts.get(lane.id)?.agentStatusTs ?? null,
      commitTs: lane.branch === null ? null : (commitTsByBranch.get(lane.branch) ?? null),
    })
    lane.rank = lane.pathologies.reduce<LadderRank>((rank, p) => worseRank(rank, p.rank), 'calm')
    lane.activity = activityOf(lane, now)
  }

  // Off-fence needs the file list a second time to keep the victim names; do it
  // here rather than threading them back out of `diagnose`.
  if (manifest !== null) {
    for (const lane of lanes) {
      const handle = lane.handle ?? lane.id
      const touched = lane.branch === null ? [] : (touches[lane.branch] ?? []).map((t) => t.path)
      lane.trespasses = findTrespasses(manifest, handle, touched)
    }
  }

  lanes.sort(byAttentionThenSize)

  const attention = buildAttention(lanes, collisions, state, now)
  const rank = attention.reduce<LadderRank>((worst, item) => worseRank(worst, item.rank), 'calm')

  const commitsHome =
    mainBranch === null ? 0 : (state.branches[mainBranch]?.commits.length ?? 0)

  return {
    now,
    root: {
      repoName: state.session?.repoName ?? null,
      mainBranch,
      worktreePath: main?.path ?? null,
      commitsHome,
      landings: worktrees.filter((view) => !view.isMain && !view.present).length,
      conductorOutputTokens,
      overheadRatio: roleSplit.overheadRatio,
      lastCommitTs: mainBranch === null ? null : (commitTsByBranch.get(mainBranch) ?? null),
    },
    lanes,
    rank,
    attention,
    evidence: {
      lanes: lanes.length,
      working: lanes.filter((lane) => lane.activity === 'working').length,
      commitsHome,
      branchesChecked: Object.keys(state.branches).length,
      filesChecked: countTouchedFiles(touches),
      collisions: collisions.length,
    },
    gaps: buildGaps(state, totals, lanes, manifest),
    totals,
    tokenTotals,
    rate,
    outputPerMin: outputPerMinute(rate, windowMs),
    overheadRatio: roleSplit.overheadRatio,
    hasFenceManifest: manifest !== null,
    eventCount: state.eventCount,
  }
}

// --- the five detectors ------------------------------------------------------

interface DiagnoseContext {
  now: number
  medianOutputPerMin: number
  manifest: LaneManifest | null
  touched: readonly string[]
  paneActivityTs: number | null
  agentStatusTs: number | null
  commitTs: number | null
}

function diagnose(lane: Lane, ctx: DiagnoseContext): Pathology[] {
  const found: Pathology[] = []

  const looping = detectLooping(lane, ctx)
  if (looping !== null) found.push(looping)

  const frozen = detectFrozen(lane, ctx)
  if (frozen !== null) found.push(frozen)

  // A frozen thread cannot also be a raised hand: silence means one thing.
  const waiting = frozen === null ? detectWaiting(lane, ctx) : null
  if (waiting !== null) found.push(waiting)

  const expensive = detectExpensive(lane, ctx)
  if (expensive !== null) found.push(expensive)

  const offFence = detectOffFence(lane, ctx)
  if (offFence !== null) found.push(offFence)

  return found
}

/**
 * LOOPING — repeating tool-call cycles with no progress. Derived from
 * `tool.activity` (the cycle) plus `commit.landed` (the progress): a lane
 * running `Read→Edit→Bash` four times over and landing nothing is stuck, while
 * the same cycle punctuated by a commit is just work.
 */
function detectLooping(lane: Lane, ctx: DiagnoseContext): Pathology | null {
  const seq = lane.recentTools
  if (seq.length < LOOP_MIN_PERIOD * LOOP_MIN_REPEATS) return null
  if (ctx.commitTs !== null && ctx.commitTs >= ctx.now - LOOP_WINDOW_MS) return null

  const cycle = findCycle(seq)
  if (cycle === null) return null

  return {
    kind: 'looping',
    rank: PATHOLOGY_RANK.looping,
    since: ctx.now - LOOP_WINDOW_MS,
    evidence: `${cycle.pattern.join('→')} ×${cycle.repeats}, no commit`,
    inferred: false,
  }
}

/** The smallest tool cycle the tail of the sequence repeats, if any. */
export function findCycle(
  seq: readonly string[],
): { pattern: string[]; repeats: number } | null {
  for (let period = LOOP_MIN_PERIOD; period <= LOOP_MAX_PERIOD; period += 1) {
    if (seq.length < period * LOOP_MIN_REPEATS) break
    const pattern = seq.slice(seq.length - period)
    // A one-tool "cycle" is not a cycle; exploring reads the same file twice.
    if (new Set(pattern).size < 2) continue

    let repeats = 1
    for (let start = seq.length - period * 2; start >= 0; start -= period) {
      const window = seq.slice(start, start + period)
      if (!window.every((tool, i) => tool === pattern[i])) break
      repeats += 1
    }
    if (repeats >= LOOP_MIN_REPEATS) return { pattern, repeats }
  }
  return null
}

/**
 * FROZEN — no events at all. A lane whose agent said `done` is finished, not
 * flatlined, and a worktree that has been removed has landed; neither is a
 * fault, so neither is reported as one.
 */
function detectFrozen(lane: Lane, ctx: DiagnoseContext): Pathology | null {
  if (!lane.present) return null
  if (lane.agentStatus === 'done') return null
  if (lane.ageMs === null || lane.ageMs < FROZEN_AFTER_MS) return null
  return {
    kind: 'frozen',
    rank: PATHOLOGY_RANK.frozen,
    since: lane.lastEventTs,
    evidence: `no events for ${formatSpan(lane.ageMs)}`,
    inferred: false,
  }
}

/**
 * WAITING — stopped with its hand up. Certain when workmux said so; otherwise
 * inferred from the pane still moving while telemetry has gone quiet, and
 * flagged as inferred, because that is a weaker signal than a declaration
 * (prd3 ruling 18).
 */
function detectWaiting(lane: Lane, ctx: DiagnoseContext): Pathology | null {
  if (lane.agentStatus === 'waiting') {
    return {
      kind: 'waiting',
      rank: PATHOLOGY_RANK.waiting,
      // How long the hand has been up is when workmux said so — not the lane's
      // last event, which a pane heartbeat keeps refreshing while it waits.
      since: ctx.agentStatusTs ?? lane.lastEventTs,
      evidence: 'workmux reports waiting',
      inferred: false,
    }
  }
  if (lane.agentStatus === 'done' || !lane.present) return null
  if (lane.ageMs === null || lane.ageMs < WAITING_QUIET_MS) return null
  if (ctx.paneActivityTs === null) return null
  if (ctx.now - ctx.paneActivityTs > WAITING_PANE_FRESH_MS) return null
  return {
    kind: 'waiting',
    rank: PATHOLOGY_RANK.waiting,
    since: lane.lastEventTs,
    evidence: `quiet ${formatSpan(lane.ageMs)}, pane still alive`,
    inferred: true,
  }
}

/** EXPENSIVE — a burn outlier against the fleet median, not against a budget. */
function detectExpensive(lane: Lane, ctx: DiagnoseContext): Pathology | null {
  if (lane.outputPerMin < EXPENSIVE_FLOOR_PER_MIN) return null
  const threshold = Math.max(
    EXPENSIVE_FLOOR_PER_MIN,
    ctx.medianOutputPerMin * EXPENSIVE_MULTIPLE,
  )
  if (lane.outputPerMin < threshold) return null
  const multiple =
    ctx.medianOutputPerMin > 0 ? lane.outputPerMin / ctx.medianOutputPerMin : Infinity
  return {
    kind: 'expensive',
    rank: PATHOLOGY_RANK.expensive,
    since: null,
    evidence: `${Math.round(lane.outputPerMin)} out-tok/min, ${
      Number.isFinite(multiple) ? `${multiple.toFixed(1)}×` : '≫'
    } fleet median`,
    inferred: false,
  }
}

/** OFF-FENCE — touching files outside the fence the lane was dispatched with. */
function detectOffFence(lane: Lane, ctx: DiagnoseContext): Pathology | null {
  if (ctx.manifest === null) return null
  const handle = lane.handle ?? lane.id
  if (ctx.manifest[handle] === undefined) return null
  const trespasses = findTrespasses(ctx.manifest, handle, ctx.touched)
  if (trespasses.length === 0) return null

  const victims = [...new Set(trespasses.map((t) => t.victim).filter((v): v is string => v !== null))]
  const first = trespasses[0] as Trespass
  return {
    kind: 'off-fence',
    rank: PATHOLOGY_RANK['off-fence'],
    since: null,
    evidence: `${trespasses.length} file${trespasses.length === 1 ? '' : 's'} outside fence — ${first.path}${
      victims.length > 0 ? ` (${victims[0]}'s)` : ''
    }`,
    inferred: false,
    victim: victims[0] ?? null,
  }
}

// --- attention ladder --------------------------------------------------------

function buildAttention(
  lanes: readonly Lane[],
  collisions: ReturnType<typeof selectCollisions>,
  state: SessionState,
  now: number,
): AttentionItem[] {
  const items: AttentionItem[] = []

  for (const lane of lanes) {
    for (const pathology of lane.pathologies) {
      items.push({
        id: `${pathology.kind}:${lane.id}`,
        laneId: lane.id,
        label: lane.label,
        kind: pathology.kind,
        rank: pathology.rank,
        forMs: pathology.since === null ? null : Math.max(0, now - pathology.since),
        evidence: pathology.evidence,
        inferred: pathology.inferred,
      })
    }
  }

  // Ruling 14: a real collision is *one* ladder item that expands, not one item
  // per contended file. Twenty-one collisions on a busy repo would otherwise
  // report as twenty-one things needing you, which is both wrong arithmetic and
  // wrong triage — it is one problem with twenty-one files in it.
  const worst = collisions[0]
  if (worst !== undefined) {
    items.push({
      id: 'collision',
      // No lane id: a collision belongs to a pair of branches, not to one lane,
      // so it must not be able to put the scene's spotlight on an arbitrary half.
      laneId: '',
      label:
        collisions.length === 1
          ? worst.branches.join(' ⇄ ')
          : `${collisions.length} files contended`,
      kind: 'collision',
      rank: 'needs-you',
      forMs: null,
      evidence: `worst: ${worst.path} — ${worst.branches.join(', ')}`,
      inferred: false,
    })
  }

  // Ruling 15: a broken collector escalates to the strip.
  for (const collector of Object.values(state.collectors)) {
    if (collector.status !== 'error') continue
    items.push({
      id: `collector:${collector.name}`,
      laneId: `collector:${collector.name}`,
      label: `${collector.name} collector`,
      kind: 'collector',
      rank: 'notice',
      forMs: collector.lastErrorTs === null ? null : Math.max(0, now - collector.lastErrorTs),
      evidence: collector.lastErrorMessage ?? `${collector.errorCount} errors`,
      inferred: false,
    })
  }

  return items.sort(
    (a, b) => LADDER_ORDER.indexOf(b.rank) - LADDER_ORDER.indexOf(a.rank) || (b.forMs ?? 0) - (a.forMs ?? 0),
  )
}

// --- gap voice (ruling 12) ---------------------------------------------------

function buildGaps(
  state: SessionState,
  totals: SpendTotals,
  lanes: readonly Lane[],
  manifest: LaneManifest | null,
): Gap[] {
  const gaps: Gap[] = []

  if (totals.costEventCount === 0) {
    gaps.push({
      what: 'NO COST FEED (OTel)',
      why: 'dollars unavailable',
      command: 'eval "$(observatory env <lane>)"',
    })
  }

  if (manifest === null) {
    gaps.push({
      what: 'NO LANE MANIFEST (.swarm/lanes.json)',
      why: 'off-fence detection unavailable',
      command: 'dispatch.sh (writes the fence manifest)',
    })
  }

  const unattributed = lanes.filter((lane) => lane.role === 'unattributed' && lane.outputTokens > 0)
  if (unattributed.length > 0) {
    gaps.push({
      what: `UNATTRIBUTED SPEND (${unattributed.length} lane${unattributed.length === 1 ? '' : 's'})`,
      why: 'burn has no declared owner',
      command: 'eval "$(observatory env <lane> --role worker)"',
    })
  }

  for (const collector of Object.values(state.collectors)) {
    if (collector.status !== 'disabled') continue
    gaps.push({
      what: `${collector.name.toUpperCase()} COLLECTOR DISABLED`,
      why: collector.disabledReason ?? 'source unavailable',
      command: 'observatory doctor',
    })
  }

  return gaps
}

// --- plumbing ----------------------------------------------------------------

interface Draft {
  id: string
  label: string
  handle: string | null
  branch: string | null
  worktreePath: string | null
  role: AgentRole
  present: boolean
  agentStatus: AgentStatus | null
  aheadOfMain: number
  dirtyCount: number
  filesTouched: number
  commitCount: number
  lastEventTs: number | null
  paneActivityTs: number | null
  /** When workmux last declared this lane's status — how long a hand has been up. */
  agentStatusTs: number | null
  firstSeenAt: number
}

function emptyDraft(id: string, seedTs: number): Draft {
  return {
    id,
    label: id,
    handle: null,
    branch: null,
    worktreePath: null,
    role: 'unattributed',
    present: true,
    agentStatus: null,
    aheadOfMain: 0,
    dirtyCount: 0,
    filesTouched: 0,
    commitCount: 0,
    lastEventTs: null,
    paneActivityTs: null,
    agentStatusTs: null,
    firstSeenAt: seedTs,
  }
}

/**
 * Every telemetry handle that resolves to this lane. Usually one; two when the
 * two collectors reported the same work under different handles, which is
 * exactly the case a lane-keyed index alone cannot join.
 */
function handlesFor(draft: Draft, spendByLane: Record<string, LaneSpend>): string[] {
  const handles = new Set<string>()
  if (draft.handle !== null && spendByLane[draft.handle] !== undefined) handles.add(draft.handle)
  for (const spend of Object.values(spendByLane)) {
    if (draft.branch !== null && spend.branch === draft.branch) handles.add(spend.lane)
    else if (draft.worktreePath !== null && spend.worktreePath === draft.worktreePath) {
      handles.add(spend.lane)
    } else if (spend.lane === draft.id) handles.add(spend.lane)
  }
  return [...handles]
}

function index(rows: readonly LaneSpend[]): Record<string, LaneSpend> {
  const out: Record<string, LaneSpend> = {}
  for (const row of rows) out[row.lane] = row
  return out
}

/** Sums two collectors' reports of the same lane. Undefined when neither had one. */
function mergeSpend(rows: readonly (LaneSpend | undefined)[]): LaneSpend | undefined {
  const present = rows.filter((row): row is LaneSpend => row !== undefined)
  if (present.length === 0) return undefined
  if (present.length === 1) return present[0]

  const first = present[0] as LaneSpend
  return present.slice(1).reduce<LaneSpend>((acc, row) => ({
    ...acc,
    tokens: {
      input: acc.tokens.input + row.tokens.input,
      output: acc.tokens.output + row.tokens.output,
      cacheRead: acc.tokens.cacheRead + row.tokens.cacheRead,
      cacheCreation: acc.tokens.cacheCreation + row.tokens.cacheCreation,
      total: acc.tokens.total + row.tokens.total,
    },
    costUsd: acc.costUsd + row.costUsd,
    authoritativeCostUsd: acc.authoritativeCostUsd + row.authoritativeCostUsd,
    estimatedCostUsd: acc.estimatedCostUsd + row.estimatedCostUsd,
    requestCount: acc.requestCount + row.requestCount,
    costEventCount: acc.costEventCount + row.costEventCount,
    toolCallCount: acc.toolCallCount + row.toolCallCount,
    threads: [...acc.threads, ...row.threads],
    lastTs: maxTs(acc.lastTs, row.lastTs),
  }), first)
}

function filamentsOf(spend: LaneSpend | undefined): Filament[] {
  if (spend === undefined) return []
  const byThread = new Map<AgentThread | null, Filament>()
  for (const thread of spend.threads) {
    const existing = byThread.get(thread.thread)
    if (existing === undefined) {
      byThread.set(thread.thread, {
        thread: thread.thread,
        outputTokens: thread.tokens.output,
        requestCount: thread.requestCount,
      })
    } else {
      existing.outputTokens += thread.tokens.output
      existing.requestCount += thread.requestCount
    }
  }
  return [...byThread.values()].sort((a, b) => b.outputTokens - a.outputTokens)
}

/** Tool names per lane inside the loop window, oldest first. */
function recentToolsByLane(state: SessionState, since: number): Map<string, string[]> {
  const byLane = new Map<string, string[]>()
  for (const record of state.telemetry.tools) {
    if (record.ts < since) continue
    const list = byLane.get(record.lane) ?? []
    list.push(record.tool)
    // A cycle is found in the tail; an unbounded tail costs memory for nothing.
    if (list.length > 48) list.shift()
    byLane.set(record.lane, list)
  }
  return byLane
}

function latestCommitTsByBranch(state: SessionState): Map<string, number> {
  const latest = new Map<string, number>()
  for (const sha of state.commitOrder) {
    const commit = state.commits[sha]
    if (commit === undefined) continue
    for (const branch of commit.branches) {
      const current = latest.get(branch)
      if (current === undefined || commit.landedAt > current) latest.set(branch, commit.landedAt)
    }
  }
  return latest
}

function dominantRole(roles: readonly AgentRole[]): AgentRole {
  if (roles.includes('worker')) return 'worker'
  if (roles.includes('conductor')) return 'conductor'
  return roles[0] ?? 'unattributed'
}

function activityOf(lane: Lane, now: number): LaneActivity {
  if (lane.pathologies.some((p) => p.kind === 'waiting')) return 'waiting'
  if (lane.agentStatus === 'done' || !lane.present) return 'done'
  if (lane.agentStatus === 'waiting') return 'waiting'
  if (lane.ageMs === null) return 'unknown'
  if (lane.ageMs <= QUIET_AFTER_MS) return 'working'
  return 'quiet'
}

function byAttentionThenSize(a: Lane, b: Lane): number {
  const rank = LADDER_ORDER.indexOf(b.rank) - LADDER_ORDER.indexOf(a.rank)
  if (rank !== 0) return rank
  if (b.outputTokens !== a.outputTokens) return b.outputTokens - a.outputTokens
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0
}

function outputPerMinute(rate: SpendRate | undefined, windowMs: number): number {
  if (rate === undefined) return 0
  const minutes = windowMs / 60_000
  return minutes === 0 ? 0 : rate.totals.tokens.output / minutes
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}

function countTouchedFiles(touches: Record<string, { path: string }[]>): number {
  const files = new Set<string>()
  for (const list of Object.values(touches)) {
    for (const touch of list) files.add(touch.path)
  }
  return files.size
}

function maxTs(...values: readonly (number | null)[]): number | null {
  let best: number | null = null
  for (const value of values) {
    if (value === null) continue
    if (best === null || value > best) best = value
  }
  return best
}

export const FLEET_WINDOW_MS = DEFAULT_SPEND_WINDOW_MS

const ZERO_TIERS: TokenTotals = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheCreation: 0,
  total: 0,
}

export function formatSpan(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h${String(minutes % 60).padStart(2, '0')}m`
}
