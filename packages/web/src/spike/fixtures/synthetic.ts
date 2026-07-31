import {
  createEvent,
  createIdFactory,
  type AgentThread,
  type ObservatoryEvent,
} from '@observatory/core'
import type { LaneFence, LaneManifest } from '../data/fences.js'
import type { Feed, FeedBatch, FixtureId } from '../feed/types.js'

/**
 * Fixtures 2 and 3 — synthetic fleets built from *real schema events*.
 *
 * Every event here goes through `createEvent`, so a payload the collectors
 * could not produce fails loudly at construction rather than quietly rendering.
 * The generator writes history first (a fleet mid-run, not one booting) and then
 * keeps emitting on a tick, so the scene's pulses have live events to be: the
 * motion-law rule that a pulse must *be* an event holds in the fixtures exactly
 * as it does on the live stream.
 *
 * These fleets are simulated. What is not simulated is the path from event to
 * pixel: the fold, the selectors, the pathology detectors and the pulse layer
 * are the same ones the live stream drives.
 */

const REPO_PATH = '/home/lachlan/observatory'
const REPO_NAME = 'observatory'
const MAIN_BRANCH = 'main'
const MODEL = 'claude-opus-5'

/** How much history a fixture opens with — a fleet mid-run has a past. */
const HISTORY_MS = 40 * 60_000
/** Wall-clock between generator ticks. */
const TICK_MS = 420
/** How long a looping lane has been turning its wheel — inside the loop window. */
const LOOP_TAIL_MS = 3.5 * 60_000

export type Behaviour =
  | 'steady'
  | 'busy'
  | 'looping'
  | 'frozen'
  | 'waiting'
  | 'expensive'
  | 'off-fence'

export interface LaneSpec {
  name: string
  behaviour: Behaviour
  /** Relative share of the fleet's traffic. */
  weight: number
  /** Seed volume of subagent work — drives the second-growth filaments. */
  subagentShare: number
  fence: string[]
  /** Files this lane commits and dirties. Off-fence lanes list a neighbour's. */
  touches: string[]
  issue: string | null
}

export interface FixtureSpec {
  id: FixtureId
  label: string
  provenance: string
  lanes: LaneSpec[]
  /** Fixtures declare a fence manifest; the live stream has none. */
  withManifest: boolean
}

// --- the two fixtures --------------------------------------------------------

const AREAS = [
  'packages/core/src/selectors',
  'packages/core/src/events',
  'packages/server/src/collectors/git',
  'packages/server/src/collectors/otel',
  'packages/server/src/api',
  'packages/web/src/panels/ledger',
  'packages/web/src/panels/spend',
  'packages/web/src/scene',
  'packages/web/src/app',
  'docs',
]

const FLEET20_NAMES = [
  '81-thread-rollup',
  '82-cost-authority',
  '83-fence-manifest',
  '84-pulse-budget',
  '85-glance-test',
  '86-ladder-hues',
  '87-tabular-numerals',
  '88-drawer-activity',
  '89-attach-command',
  '90-replay-frame',
  '91-collector-bar',
  '92-feed-filters',
  '93-sigil-marks',
  '94-node-glyphs',
  '95-reduced-motion',
  '96-favicon-badge',
  '97-focus-mode',
  '98-collapse-prefs',
  '99-si-formatter',
  '100-evidence-lines',
]

/**
 * Fixture 2 — ruling 22's scale test: twenty lanes, all threaded, all healthy.
 *
 * Deliberately calm. Its job is the glance test at scale, so nothing is staged
 * here: no fault, no shared file, and a burn spread tight enough that no lane is
 * three times the fleet median. Whatever the detectors say about it, they said
 * it on their own — and what they should say is ALL CLEAR, with the evidence
 * that earned it.
 */
export function fleet20Spec(): FixtureSpec {
  return {
    id: 'fleet20',
    label: '20-LANE',
    provenance: 'synthetic · 20 lanes · real schema events',
    withManifest: true,
    lanes: FLEET20_NAMES.map((name, i) => {
      // Each lane gets its own sub-area, so twenty lanes can share ten
      // directories without two of them ever touching the same file.
      const area = `${AREAS[i % AREAS.length] as string}/${name.split('-')[0] ?? i}`
      return {
        name,
        behaviour: 'steady' as Behaviour,
        // A real fleet is not uniform — thread thickness is only worth reading
        // because lanes differ — but the spread stays inside the outlier test.
        weight: 0.7 + ((i * 7) % 11) / 11,
        subagentShare: i % 3 === 0 ? 0.34 : i % 4 === 0 ? 0.18 : 0,
        fence: [`${area}/**`],
        touches: [`${area}/${name.split('-').slice(1).join('-')}.ts`],
        issue: name.split('-')[0] ?? null,
      }
    }),
  }
}

/** Fixture 3 — one lane per pathology, plus healthy neighbours to fail against. */
export function pathologySpec(): FixtureSpec {
  const lane = (
    name: string,
    behaviour: Behaviour,
    area: string,
    overrides: Partial<LaneSpec> = {},
  ): LaneSpec => ({
    name,
    behaviour,
    weight: 1,
    subagentShare: 0,
    fence: [`${area}/**`],
    touches: [`${area}/${name.split('-').slice(1).join('-')}.ts`],
    issue: name.split('-')[0] ?? null,
    ...overrides,
  })

  return {
    id: 'pathology',
    label: 'PATHOLOGY',
    provenance: 'synthetic · one lane per pathology · real schema events',
    withManifest: true,
    lanes: [
      lane('41-retry-parser', 'looping', 'packages/server/src/collectors/git', {
        weight: 0.9,
        subagentShare: 0.2,
      }),
      lane('42-otel-receiver', 'frozen', 'packages/server/src/collectors/otel', { weight: 0.7 }),
      lane('43-drawer-attach', 'waiting', 'packages/web/src/panels/drawer', { weight: 0.8 }),
      lane('44-scene-pulses', 'expensive', 'packages/web/src/scene', {
        weight: 2.4,
        subagentShare: 0.42,
      }),
      lane('45-ledger-subrows', 'off-fence', 'packages/web/src/panels/ledger', {
        weight: 1.1,
        // Its own fence is the ledger panel; it has its hands in core's selectors.
        touches: [
          'packages/web/src/panels/ledger/index.tsx',
          'packages/core/src/selectors/spend.ts',
          'packages/core/src/selectors/threads.ts',
        ],
      }),
      lane('46-spend-selectors', 'steady', 'packages/core/src/selectors', {
        weight: 1.4,
        subagentShare: 0.25,
      }),
      lane('47-format-module', 'steady', 'packages/web/src/lib', { weight: 0.9 }),
      lane('48-doctor-report', 'steady', 'packages/server/src/cli', { weight: 1.2 }),
      lane('49-stream-route', 'busy', 'packages/server/src/api', {
        weight: 1.8,
        subagentShare: 0.3,
      }),
    ],
  }
}

export function specFor(id: Exclude<FixtureId, 'live'>): FixtureSpec {
  return id === 'fleet20' ? fleet20Spec() : pathologySpec()
}

export function manifestFor(spec: FixtureSpec): LaneManifest | null {
  if (!spec.withManifest) return null
  const manifest: LaneManifest = {}
  for (const lane of spec.lanes) {
    const fence: LaneFence = {
      handle: lane.name,
      fence: lane.fence,
      issue: lane.issue,
      model: MODEL,
    }
    manifest[lane.name] = fence
  }
  return manifest
}

// --- the generator -----------------------------------------------------------

/** Deterministic PRNG so a fixture screenshots the same way twice. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const LOOP_CYCLE = ['Read', 'Edit', 'Bash'] as const
const TOOLS = ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'] as const

interface LaneRuntime {
  spec: LaneSpec
  worktreePath: string
  sessionId: string
  paneId: string
  commits: number
  loopStep: number
  /** Wall-clock of the lane's last generated telemetry event. */
  lastTs: number
}

export class SyntheticFleet {
  private readonly nextId = createIdFactory('fx')
  private readonly random: () => number
  private readonly lanes: LaneRuntime[]

  constructor(private readonly spec: FixtureSpec, seed = 0x5eed) {
    this.random = mulberry32(seed)
    this.lanes = spec.lanes.map((laneSpec, i) => ({
      spec: laneSpec,
      worktreePath: `${REPO_PATH}__worktrees/${laneSpec.name}`,
      sessionId: `sess-${laneSpec.name}`,
      paneId: `%${200 + i}`,
      commits: 0,
      loopStep: 0,
      lastTs: 0,
    }))
  }

  /** The fleet's past: enough of it that recency, size and rate all mean something. */
  history(now: number): ObservatoryEvent[] {
    const events: ObservatoryEvent[] = []
    const start = now - HISTORY_MS

    events.push(
      createEvent(
        'session.started',
        { sessionId: 'fx-session', repoPath: REPO_PATH, repoName: REPO_NAME, mainBranch: MAIN_BRANCH },
        { id: this.nextId(), ts: start },
      ),
      createEvent(
        'worktree.discovered',
        { path: REPO_PATH, branch: MAIN_BRANCH, head: 'sha-main-000', isMain: true },
        { id: this.nextId(), ts: start },
      ),
    )

    for (const lane of this.lanes) {
      events.push(
        createEvent(
          'worktree.discovered',
          {
            path: lane.worktreePath,
            branch: lane.spec.name,
            head: `sha-${lane.spec.name}-000`,
            isMain: false,
          },
          { id: this.nextId(), ts: start + 500 },
        ),
        createEvent(
          'pane.discovered',
          {
            paneId: lane.paneId,
            windowName: `wm-${lane.spec.name}`,
            currentPath: lane.worktreePath,
            currentCommand: 'claude',
            worktreePath: lane.worktreePath,
          },
          { id: this.nextId(), ts: start + 600 },
        ),
      )
    }

    // The conductor's own burn: without it the overhead ratio has no numerator,
    // and prd2's whole point is that the orchestrator's spend is not free.
    for (let i = 0; i < 90; i += 1) {
      const ts = start + Math.floor((HISTORY_MS * i) / 90)
      events.push(...this.conductorBurn(ts))
    }

    // Per-lane traffic, oldest first. `endAt` is where a lane's activity stops:
    // a frozen lane's log simply ends, which is the fact the detector reads.
    for (const lane of this.lanes) {
      const endAt = this.laneEndTs(lane, now)
      // A looping lane's tail must be the cycle itself and nothing else —
      // interleaving random tool calls would hide the very pattern the detector
      // is supposed to find. Its earlier history is ordinary work, because a
      // lane that was always looping was never working.
      const burnUntil = lane.spec.behaviour === 'looping' ? endAt - LOOP_TAIL_MS : endAt
      const density = Math.max(6, Math.round(28 * lane.spec.weight))
      for (let i = 0; i < density; i += 1) {
        const ts = start + 1000 + Math.floor(((burnUntil - start - 1000) * i) / density)
        events.push(...this.laneBurn(lane, ts, i))
      }
      if (lane.spec.behaviour === 'looping') {
        const steps = 18
        for (let i = 0; i < steps; i += 1) {
          events.push(this.loopStep(lane, burnUntil + Math.floor((LOOP_TAIL_MS * i) / steps)))
        }
      }
      events.push(...this.laneGeography(lane, endAt))
      events.push(...this.laneStatus(lane, endAt, now))
    }

    // main's own history — the commits that already came home.
    for (let i = 0; i < 14; i += 1) {
      const ts = start + Math.floor((HISTORY_MS * i) / 16)
      events.push(
        createEvent(
          'commit.landed',
          {
            sha: `sha-main-${String(i).padStart(3, '0')}`,
            branch: MAIN_BRANCH,
            message: `chore: land ${i}`,
            author: { name: 'conductor', email: 'conductor@observatory' },
            authoredAt: ts,
            files: [{ path: 'docs/roadmap.md', status: 'modified', insertions: 6, deletions: 2 }],
            insertions: 6,
            deletions: 2,
            worktreePath: REPO_PATH,
          },
          { id: this.nextId(), ts },
        ),
      )
    }

    return events.sort((a, b) => a.ts - b.ts)
  }

  /** One instant of live traffic. Quiet lanes contribute nothing, on purpose. */
  tick(now: number): ObservatoryEvent[] {
    const events: ObservatoryEvent[] = []

    for (const lane of this.lanes) {
      const behaviour = lane.spec.behaviour
      if (behaviour === 'frozen' || behaviour === 'waiting') continue

      // Looping lanes keep turning their cycle: the orbiting pulse advances one
      // step per tool call, so if the cycle stopped the orbit would stop too.
      if (behaviour === 'looping') {
        if (this.random() < 0.55) events.push(this.loopStep(lane, now))
        continue
      }

      // More, smaller requests rather than fewer, bigger ones: the trailing-window
      // burn rate is a real derivation, so a sparse fixture makes it jittery
      // enough to trip the outlier test on noise alone.
      const chance = behaviour === 'expensive' ? 0.34 : 0.14 * lane.spec.weight
      if (this.random() > chance) continue
      events.push(...this.laneBurn(lane, now, Math.floor(this.random() * 1000)))

      if (this.random() < 0.05) events.push(...this.laneCommit(lane, now))
    }

    if (this.random() < 0.35) events.push(...this.conductorBurn(now))

    // A pane heartbeat keeps the waiting lane's "pane is still alive" signal
    // true, which is exactly the weaker evidence the waiting detector flags.
    for (const lane of this.lanes) {
      if (lane.spec.behaviour !== 'waiting') continue
      events.push(
        createEvent(
          'pane.activity',
          {
            paneId: lane.paneId,
            contentHash: `hash-${Math.floor(now / 1000)}`,
            lines: 51,
            preview: 'Do you want to proceed? ❯ 1. Yes  2. No',
          },
          { id: this.nextId(), ts: now },
        ),
      )
    }

    return events
  }

  // --- pieces ---------------------------------------------------------------

  /** Where a lane's log stops. Only frozen and waiting lanes stop early. */
  private laneEndTs(lane: LaneRuntime, now: number): number {
    switch (lane.spec.behaviour) {
      // Past FROZEN_AFTER_MS (8m) with nobody saying "done".
      case 'frozen':
        return now - 11 * 60_000
      // Past WAITING_QUIET_MS (75s) with the pane still moving.
      case 'waiting':
        return now - 2 * 60_000 - 40_000
      default:
        return now - 2_000
    }
  }

  private laneBurn(lane: LaneRuntime, ts: number, i: number): ObservatoryEvent[] {
    const events: ObservatoryEvent[] = []
    const thread: AgentThread =
      lane.spec.subagentShare > 0 && this.random() < lane.spec.subagentShare ? 'subagent' : 'main'

    const scale = lane.spec.behaviour === 'expensive' ? 1.6 : 1
    const output = Math.round((90 + this.random() * 250) * lane.spec.weight * scale)
    const cacheRead = Math.round(60_000 + this.random() * 80_000)

    events.push(
      createEvent(
        'llm.usage',
        {
          lane: lane.spec.name,
          role: 'worker',
          model: MODEL,
          tokens: {
            input: Math.round(2 + this.random() * 40),
            output,
            cacheRead,
            cacheCreation: Math.round(900 + this.random() * 2600),
          },
          requestId: `req-${lane.spec.name}-${i}`,
          durationMs: Math.round(3_000 + this.random() * 26_000),
          sessionId: lane.sessionId,
          worktreePath: lane.worktreePath,
          branch: lane.spec.name,
          thread,
        },
        { id: this.nextId(), ts },
      ),
    )

    // Dollars come from the authority collector, as they do in production.
    events.push(
      createEvent(
        'llm.cost',
        {
          lane: lane.spec.name,
          role: 'worker',
          model: MODEL,
          costUsd: Number(((output / 1000) * 0.075 + (cacheRead / 1_000_000) * 1.5).toFixed(6)),
          authoritative: true,
          sessionId: lane.sessionId,
          worktreePath: lane.worktreePath,
          branch: lane.spec.name,
          thread,
        },
        { id: this.nextId(), ts, source: 'otel' },
      ),
    )

    const toolCount = 1 + Math.floor(this.random() * 3)
    for (let t = 0; t < toolCount; t += 1) {
      events.push(
        createEvent(
          'tool.activity',
          {
            lane: lane.spec.name,
            tool: TOOLS[Math.floor(this.random() * TOOLS.length)] as string,
            role: 'worker',
            durationMs: Math.round(40 + this.random() * 3_000),
            sessionId: lane.sessionId,
            worktreePath: lane.worktreePath,
            branch: lane.spec.name,
            thread,
          },
          { id: this.nextId(), ts: ts + t * 60 },
        ),
      )
    }

    lane.lastTs = ts
    return events
  }

  /** One turn of a stuck lane's wheel: the repeating cycle the detector reads. */
  private loopStep(lane: LaneRuntime, ts: number): ObservatoryEvent {
    const tool = LOOP_CYCLE[lane.loopStep % LOOP_CYCLE.length] as string
    lane.loopStep += 1
    lane.lastTs = ts
    return createEvent(
      'tool.activity',
      {
        lane: lane.spec.name,
        tool,
        role: 'worker',
        durationMs: 800,
        sessionId: lane.sessionId,
        worktreePath: lane.worktreePath,
        branch: lane.spec.name,
        thread: 'main',
      },
      { id: this.nextId(), ts },
    )
  }

  private laneCommit(lane: LaneRuntime, ts: number): ObservatoryEvent[] {
    lane.commits += 1
    const sha = `sha-${lane.spec.name}-${String(lane.commits).padStart(3, '0')}`
    const files = lane.spec.touches.map((path, i) => ({
      path,
      status: (i === 0 ? 'modified' : 'added') as 'modified' | 'added',
      insertions: 8 + Math.floor(this.random() * 90),
      deletions: Math.floor(this.random() * 20),
    }))
    return [
      createEvent(
        'commit.landed',
        {
          sha,
          branch: lane.spec.name,
          message: `feat(${lane.spec.issue ?? lane.spec.name}): step ${lane.commits}`,
          author: { name: lane.spec.name, email: 'agent@observatory' },
          authoredAt: ts,
          files,
          insertions: files.reduce((sum, f) => sum + f.insertions, 0),
          deletions: files.reduce((sum, f) => sum + f.deletions, 0),
          worktreePath: lane.worktreePath,
        },
        { id: this.nextId(), ts },
      ),
      createEvent(
        'branch.updated',
        {
          branch: lane.spec.name,
          head: sha,
          worktreePath: lane.worktreePath,
          aheadOfMain: lane.commits,
          behindMain: 0,
        },
        { id: this.nextId(), ts: ts + 20 },
      ),
    ]
  }

  /**
   * A lane's git geography: the commits and dirty files that make "where is
   * this agent" answerable — and that off-fence detection reads.
   */
  private laneGeography(lane: LaneRuntime, endAt: number): ObservatoryEvent[] {
    const events: ObservatoryEvent[] = []
    const commits = lane.spec.behaviour === 'looping' ? 0 : 1 + Math.floor(this.random() * 3)
    for (let i = 0; i < commits; i += 1) {
      events.push(...this.laneCommit(lane, endAt - (commits - i) * 4 * 60_000))
    }
    events.push(
      createEvent(
        'worktree.dirty',
        {
          path: lane.worktreePath,
          branch: lane.spec.name,
          files: lane.spec.touches.map((path) => ({ path, status: 'modified' as const })),
        },
        { id: this.nextId(), ts: endAt - 30_000 },
      ),
    )
    return events
  }

  private laneStatus(lane: LaneRuntime, endAt: number, now: number): ObservatoryEvent[] {
    // Only the waiting lane has workmux declaring a stop; everyone else is
    // working, which is what makes the frozen lane's silence a fault and not a
    // finish.
    const status = lane.spec.behaviour === 'waiting' ? 'waiting' : 'working'
    return [
      createEvent(
        'agent.status',
        {
          handle: lane.spec.name,
          status,
          worktreePath: lane.worktreePath,
          branch: lane.spec.name,
          // From the generator's own clock, never `Date.now()`: the fixture has
          // to be reproducible from a given `now`, including under test.
          elapsedSeconds: Math.max(0, Math.round((now - endAt) / 1000)),
        },
        { id: this.nextId(), ts: endAt },
      ),
    ]
  }

  private conductorBurn(ts: number): ObservatoryEvent[] {
    const output = Math.round(200 + this.random() * 700)
    return [
      createEvent(
        'llm.usage',
        {
          lane: 'conductor',
          role: 'conductor',
          model: MODEL,
          tokens: {
            input: 8,
            output,
            cacheRead: Math.round(70_000 + this.random() * 60_000),
            cacheCreation: 1_600,
          },
          sessionId: 'sess-conductor',
          worktreePath: REPO_PATH,
          branch: MAIN_BRANCH,
          thread: 'main',
        },
        { id: this.nextId(), ts },
      ),
    ]
  }
}

// --- the feed ----------------------------------------------------------------

export function createSyntheticFeed(id: Exclude<FixtureId, 'live'>): Feed {
  const spec = specFor(id)
  const fleet = new SyntheticFleet(spec)
  const listeners = new Set<(batch: FeedBatch) => void>()
  const manifest = manifestFor(spec)

  const now = Date.now()
  const history = fleet.history(now)
  let timer: ReturnType<typeof setInterval> | null = null
  let replayed = false

  const emit = (batch: FeedBatch) => {
    for (const listener of listeners) listener(batch)
  }

  return {
    id,
    label: spec.label,
    provenance: spec.provenance,
    manifest,
    subscribe(listener) {
      listeners.add(listener)
      if (!replayed) {
        replayed = true
        // History does not pulse — same rule as the live stream's replay burst.
        queueMicrotask(() => emit({ events: history, historical: true }))
        timer = setInterval(() => {
          const events = fleet.tick(Date.now())
          if (events.length > 0) emit({ events, historical: false })
        }, TICK_MS)
      }
      return () => listeners.delete(listener)
    },
    stop() {
      listeners.clear()
      if (timer !== null) clearInterval(timer)
      timer = null
    },
  }
}
