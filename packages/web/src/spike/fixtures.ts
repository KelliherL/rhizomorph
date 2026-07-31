import {
  createEvent,
  createIdFactory,
  type EventType,
  type ObservatoryEvent,
  type PayloadOf,
  type SourceOf,
} from '@observatory/core'
import { detectCycle, type LaneManifest } from './fleet.js'

/**
 * SPIKE A — the two synthetic fixtures.
 *
 * Both are built from real, schema-validated `ObservatoryEvent`s and folded by
 * the same `reduceAll` the live stream uses: there is no fixture-only code path
 * anywhere downstream of here. Timestamps are relative to a `now` handed in, so
 * recency, liveness and the five detectors all fire for real rather than being
 * hard-coded into a display.
 */

export interface Fixture {
  events: ObservatoryEvent[]
  manifest: LaneManifest
}

const REPO = '/home/lachlan/worktrees-challenge'
const WT = (name: string) => `${REPO}__worktrees/${name}`
const MIN = 60_000

/** A tiny event builder — id sequencing and envelope filling, nothing else. */
class Log {
  private readonly nextId = createIdFactory('fx')
  readonly events: ObservatoryEvent[] = []

  push<T extends EventType>(
    type: T,
    ts: number,
    payload: PayloadOf<T>,
    source?: SourceOf<T>,
  ): void {
    this.events.push(
      createEvent(type, payload, {
        id: this.nextId(),
        ts: Math.round(ts),
        ...(source === undefined ? {} : { source }),
      }),
    )
  }

  /** Sorted by ts so the fold sees a plausible arrival order. */
  sorted(): ObservatoryEvent[] {
    return [...this.events].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id))
  }
}

/** Deterministic pseudo-random — a fixture must screenshot the same twice. */
function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

const TOOLS = ['Read', 'Edit', 'Bash', 'Grep', 'Write', 'Glob', 'Task', 'WebFetch']
const MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']

// ── the lane recipe ─────────────────────────────────────────────────────────

interface LaneSpec {
  handle: string
  issue: string | null
  fence: string[]
  /** Session output tokens for this lane. Drives bead area. */
  outputTokens: number
  /** Output tokens/minute inside the trailing 5-minute window. */
  ratePerMin: number
  /** How long ago the lane last did anything, in ms. */
  quietMs: number
  commits: number
  aheadOfMain: number
  dirty: number
  status: 'working' | 'waiting' | 'done'
  /** ms since the lane entered `status` — workmux keeps re-reporting. */
  statusSinceMs?: number
  subagents: number
  /** A repeating tool cycle instead of varied work. */
  loop?: string[]
  /** Extra files this lane has touched, which may fall outside its fence. */
  strayFiles?: string[]
  seed: number
}

function writeLane(log: Log, now: number, spec: LaneSpec, mainBranch: string): void {
  const path = WT(spec.handle)
  const random = rng(spec.seed)
  const discovered = now - 42 * MIN
  const last = now - spec.quietMs

  log.push('worktree.discovered', discovered, {
    path,
    branch: spec.handle,
    head: `sha-${spec.handle}-head`,
    isMain: false,
  })
  log.push('pane.discovered', discovered + 400, {
    paneId: `%${spec.seed}`,
    windowName: spec.handle,
    currentPath: path,
    worktreePath: path,
    currentCommand: 'claude',
  })

  // ── git: commits, then the branch head ────────────────────────────────────
  // Generated files must land INSIDE the fence, or every lane would read as a
  // trespasser and the one staged off-fence lane would mean nothing.
  const dir =
    (spec.fence.find((glob) => glob.includes('**')) ?? spec.fence[0] ?? 'src').replace(
      /\/?\*\*.*$/,
      '',
    ) || 'src'
  for (let i = 0; i < spec.commits; i += 1) {
    const ts = discovered + ((i + 1) / (spec.commits + 1)) * (last - discovered)
    const file = `${dir}/${['index', 'model', 'view', 'util'][i % 4]}.ts`
    log.push('commit.landed', ts, {
      sha: `sha-${spec.handle}-${i}`,
      branch: spec.handle,
      message: `${['feat', 'fix', 'refactor', 'test'][i % 4]}(${spec.handle.split('-')[1] ?? 'lane'}): step ${i + 1}`,
      author: { name: spec.handle, email: `${spec.handle}@swarm` },
      authoredAt: Math.round(ts),
      files: [{ path: file, status: 'modified', insertions: 20 + i * 7, deletions: i * 3 }],
      insertions: 20 + i * 7,
      deletions: i * 3,
      worktreePath: path,
    })
  }

  for (const stray of spec.strayFiles ?? []) {
    log.push('commit.landed', last - 90_000, {
      sha: `sha-${spec.handle}-stray-${stray.length}`,
      branch: spec.handle,
      message: `chore: quick fix in ${stray}`,
      author: { name: spec.handle, email: `${spec.handle}@swarm` },
      authoredAt: Math.round(last - 90_000),
      files: [{ path: stray, status: 'modified', insertions: 9, deletions: 2 }],
      insertions: 9,
      deletions: 2,
      worktreePath: path,
    })
  }

  log.push('branch.updated', last - 30_000, {
    branch: spec.handle,
    head: `sha-${spec.handle}-head`,
    worktreePath: path,
    aheadOfMain: spec.aheadOfMain,
    behindMain: 0,
  })

  if (spec.dirty > 0) {
    log.push('worktree.dirty', last - 20_000, {
      path,
      branch: spec.handle,
      files: Array.from({ length: spec.dirty }, (_, i) => ({
        path: `${dir}/wip-${i}.ts`,
        status: 'modified' as const,
      })),
    })
  }

  // ── tmux heartbeat ────────────────────────────────────────────────────────
  const beats = 14
  for (let i = 0; i < beats; i += 1) {
    const ts = discovered + ((i + 1) / beats) * (last - discovered)
    log.push('pane.activity', ts, {
      paneId: `%${spec.seed}`,
      contentHash: `h-${spec.handle}-${i}`,
      previousHash: `h-${spec.handle}-${i - 1}`,
      preview: spec.loop ? `${spec.loop[i % spec.loop.length]}…` : 'working',
    })
  }

  // ── workmux status. Re-reported on a poll, so `updatedAt` is recent while
  //    the *transition* is not — which is what "waiting 6m" has to be read off.
  const statusSince = now - (spec.statusSinceMs ?? spec.quietMs)
  for (let ts = statusSince; ts <= last; ts += 60_000) {
    log.push('agent.status', ts, {
      handle: spec.handle,
      status: spec.status,
      worktreePath: path,
      branch: spec.handle,
    })
  }

  // ── telemetry ─────────────────────────────────────────────────────────────
  const sessionId = `sess-${spec.handle}`
  const model = MODELS[spec.seed % MODELS.length] as string
  const windowStart = now - 5 * MIN

  // Subagent threads: a small share of the lane's own output, spent earlier in
  // the session. Kept out of the trailing window on purpose — a burst of
  // subagent traffic landing inside it would make every lane a burn outlier
  // and EXPENSIVE would stop meaning anything.
  const perSubagent = Math.round(spec.outputTokens * 0.03)
  for (let i = 0; i < spec.subagents; i += 1) {
    const ts = discovered + ((i + 1) / (spec.subagents + 1)) * (last - 7 * MIN - discovered)
    if (ts <= discovered || ts >= last) continue
    usage(log, ts, {
      lane: spec.handle,
      path,
      sessionId,
      model: MODELS[(spec.seed + i) % MODELS.length] as string,
      output: perSubagent,
      thread: 'subagent',
      requestId: `req-${spec.handle}-sub-${i}`,
    })
  }

  // Historic main-thread spend, spread across the session outside the window…
  const inWindow = spec.ratePerMin * 5
  const historic = Math.max(0, spec.outputTokens - inWindow - perSubagent * spec.subagents)
  const historicRequests = 26
  for (let i = 0; i < historicRequests; i += 1) {
    const ts = discovered + ((i + 1) / (historicRequests + 1)) * (last - 6 * MIN - discovered)
    if (ts >= last) break
    const output = Math.round((historic / historicRequests) * (0.6 + random() * 0.8))
    usage(log, ts, { lane: spec.handle, path, sessionId, model, output, thread: 'main' })
  }

  // …and the trailing window, which is what the burn rate actually measures.
  const windowRequests = 10
  for (let i = 0; i < windowRequests; i += 1) {
    const ts = windowStart + ((i + 1) / windowRequests) * 5 * MIN
    if (ts > last) break
    usage(log, ts, {
      lane: spec.handle,
      path,
      sessionId,
      model,
      output: Math.round(inWindow / windowRequests),
      thread: 'main',
    })
  }

  // Dollars — authoritative, the way OTel reports them. Some inside the window,
  // so `$/hr` is a real rate rather than a rounding artefact.
  const costEvents = 10
  for (let i = 0; i < costEvents; i += 1) {
    const ts = discovered + ((i + 1) / (costEvents + 1)) * (last - discovered)
    log.push(
      'llm.cost',
      ts,
      {
        lane: spec.handle,
        role: 'worker',
        model,
        costUsd: (spec.outputTokens / costEvents) * 0.000075 * (0.7 + random() * 0.6),
        authoritative: true,
        sessionId,
      },
      'otel',
    )
  }
  for (let i = 0; i < 4; i += 1) {
    const ts = windowStart + ((i + 1) / 4) * 5 * MIN
    if (ts > last) break
    log.push(
      'llm.cost',
      ts,
      {
        lane: spec.handle,
        role: 'worker',
        model,
        costUsd: (inWindow / 4) * 0.000075,
        authoritative: true,
        sessionId,
      },
      'otel',
    )
  }

  // tool calls — the loop detector's only input
  const sequence = spec.loop
    ? cycleSequence(spec.loop, 27)
    : variedSequence(random, 27)
  for (let i = 0; i < sequence.length; i += 1) {
    const ts = last - (sequence.length - 1 - i) * 14_000
    log.push(
      'tool.activity',
      ts,
      {
        lane: spec.handle,
        tool: sequence[i] as string,
        role: 'worker',
        sessionId,
        worktreePath: path,
        branch: spec.handle,
        thread: 'main',
      },
      'sessionlog',
    )
  }

  void mainBranch
}

function usage(
  log: Log,
  ts: number,
  spec: {
    lane: string
    path: string
    sessionId: string
    model: string
    output: number
    thread: 'main' | 'subagent'
    requestId?: string
  },
): void {
  log.push(
    'llm.usage',
    ts,
    {
      lane: spec.lane,
      role: 'worker',
      model: spec.model,
      tokens: {
        input: Math.round(spec.output * 0.22),
        output: spec.output,
        cacheRead: Math.round(spec.output * 9),
        cacheCreation: Math.round(spec.output * 0.8),
      },
      sessionId: spec.sessionId,
      worktreePath: spec.path,
      branch: spec.lane,
      thread: spec.thread,
      ...(spec.requestId === undefined ? {} : { requestId: spec.requestId }),
    },
    'sessionlog',
  )
}

/** `Read→Edit→Bash` forever — what LOOPING looks like in the tool feed. */
function cycleSequence(cycle: string[], length: number): string[] {
  return Array.from({ length }, (_, i) => cycle[i % cycle.length] as string)
}

/**
 * Healthy work: varied, never the same tool twice running, and explicitly
 * checked against the very detector the scene uses — a fixture that
 * accidentally loops would make the staged fixture a lie.
 */
function variedSequence(random: () => number, length: number): string[] {
  const out: string[] = []
  for (let i = 0; i < length; i += 1) {
    let pick = TOOLS[Math.floor(random() * TOOLS.length)] as string
    let guard = 0
    while ((pick === out[out.length - 1] || detectCycle([...out, pick]) !== null) && guard < 40) {
      pick = TOOLS[Math.floor(random() * TOOLS.length)] as string
      guard += 1
    }
    out.push(pick)
  }
  return out
}

function preamble(log: Log, now: number, mainBranch: string): void {
  log.push('session.started', now - 45 * MIN, {
    sessionId: 'spike-a',
    repoPath: REPO,
    repoName: 'worktrees-challenge',
    mainBranch,
  })
  log.push('worktree.discovered', now - 45 * MIN + 100, {
    path: REPO,
    branch: mainBranch,
    head: 'sha-main-head',
    isMain: true,
  })
  log.push('pane.discovered', now - 45 * MIN + 200, {
    paneId: '%0',
    windowName: 'conductor',
    currentPath: REPO,
    worktreePath: REPO,
    currentCommand: 'claude',
  })
  log.push('pane.activity', now - 12_000, {
    paneId: '%0',
    contentHash: 'h-main-live',
    preview: 'conducting',
  })
  log.push('branch.updated', now - 60_000, {
    branch: mainBranch,
    head: 'sha-main-head',
    worktreePath: REPO,
    aheadOfMain: 0,
    behindMain: 0,
  })
}

function manifestOf(specs: LaneSpec[]): LaneManifest {
  const manifest: LaneManifest = {}
  for (const spec of specs) {
    manifest[spec.handle] = {
      handle: spec.handle,
      fence: spec.fence,
      issue: spec.issue,
      model: MODELS[spec.seed % MODELS.length] ?? null,
    }
  }
  return manifest
}

function build(now: number, mainBranch: string, specs: LaneSpec[]): Fixture {
  const log = new Log()
  preamble(log, now, mainBranch)
  for (const spec of specs) writeLane(log, now, spec, mainBranch)
  return { events: log.sorted(), manifest: manifestOf(specs) }
}

// ── FIXTURE 2 — twenty lanes ────────────────────────────────────────────────

const AREAS = [
  ['packages/core/**'],
  ['packages/server/**'],
  ['packages/web/**'],
  ['docs/**'],
  ['packages/server/src/collectors/**'],
  ['packages/web/src/scene/**'],
  ['packages/core/src/selectors/**'],
  ['.github/**', 'package.json'],
]

/**
 * Ruling 22's test: render everything, always. Twenty lanes, a realistic spread
 * of work sizes (30K → 940K output) and recencies (4s → 5m), two of which want
 * the operator. If the glance test fails here, ruling 22 has been falsified.
 */
export function fixture20(now: number): Fixture {
  const random = rng(9111)
  const specs: LaneSpec[] = Array.from({ length: 20 }, (_, i) => {
    const issue = 40 + i
    const area = AREAS[i % AREAS.length] as string[]
    const handle = `${issue}-${['ledger', 'doctor', 'scene', 'ticker', 'fences', 'replay', 'liveness', 'tokens', 'drawer', 'burn'][i % 10]}`
    return {
      handle,
      issue: String(issue),
      fence: area,
      outputTokens: Math.round(30_000 + random() ** 2 * 910_000),
      ratePerMin: Math.round(40 + random() * 220),
      // Capped just under the frozen threshold: this fixture tests *scale*, so
      // the pathologies in it are the two staged below, not accidents of the rng.
      quietMs: Math.round(4_000 + random() ** 2 * 205_000),
      commits: Math.floor(random() * 9),
      aheadOfMain: Math.floor(random() * 7),
      dirty: Math.floor(random() * 5),
      status: 'working',
      subagents: random() > 0.62 ? 1 + Math.floor(random() * 4) : 0,
      seed: 11 + i,
    }
  })

  // Exactly two lanes want the operator, so the strip has something true to say
  // and the other eighteen have to stay quiet around them.
  const waiting = specs[6] as LaneSpec
  waiting.status = 'waiting'
  waiting.quietMs = 25_000
  waiting.statusSinceMs = 7 * MIN

  const expensive = specs[13] as LaneSpec
  expensive.ratePerMin = 2_400
  expensive.outputTokens = 1_180_000
  expensive.quietMs = 6_000

  return build(now, 'main', specs)
}

// ── FIXTURE 3 — one of each pathology ───────────────────────────────────────

/**
 * The pathology test (definition of demo, clause 2): exactly one looping, one
 * frozen, one waiting, one expensive and one off-fence lane, among seven that
 * are fine. Every flag is *derived* — nothing here says "draw a loop".
 */
export function fixtureStaged(now: number): Fixture {
  const specs: LaneSpec[] = [
    {
      handle: '71-ledger-threads',
      issue: '71',
      fence: ['packages/web/src/panels/ledger/**'],
      outputTokens: 412_000,
      ratePerMin: 190,
      quietMs: 8_000,
      commits: 5,
      aheadOfMain: 5,
      dirty: 2,
      status: 'working',
      subagents: 2,
      seed: 21,
    },
    {
      handle: '72-otel-attribution',
      issue: '72',
      fence: ['packages/server/src/collectors/otel/**'],
      outputTokens: 268_000,
      ratePerMin: 150,
      quietMs: 21_000,
      commits: 3,
      aheadOfMain: 3,
      dirty: 0,
      status: 'working',
      subagents: 0,
      seed: 22,
    },
    {
      // LOOPING — Read→Edit→Bash on repeat, nothing landing behind it.
      handle: '73-doctor-states',
      issue: '73',
      fence: ['packages/server/src/cli/**'],
      outputTokens: 690_000,
      ratePerMin: 240,
      quietMs: 5_000,
      commits: 0,
      aheadOfMain: 0,
      dirty: 3,
      status: 'working',
      subagents: 1,
      loop: ['Read', 'Edit', 'Bash'],
      seed: 23,
    },
    {
      // FROZEN — a real half-hour of work, then dead air for nineteen minutes.
      handle: '74-macos-ci',
      issue: '74',
      fence: ['.github/**'],
      outputTokens: 244_000,
      ratePerMin: 0,
      quietMs: 19 * MIN,
      commits: 1,
      aheadOfMain: 1,
      dirty: 2,
      status: 'working',
      subagents: 1,
      seed: 24,
    },
    {
      // WAITING — stopped six minutes ago and still saying so.
      handle: '75-lane-manifest',
      issue: '75',
      fence: ['packages/server/src/collectors/**', '.swarm/**'],
      outputTokens: 331_000,
      ratePerMin: 20,
      quietMs: 18_000,
      commits: 2,
      aheadOfMain: 2,
      dirty: 6,
      status: 'waiting',
      statusSinceMs: 6 * MIN,
      subagents: 0,
      seed: 25,
    },
    {
      // EXPENSIVE — an order of magnitude over the fleet median.
      handle: '76-transcript-tail',
      issue: '76',
      fence: ['packages/server/src/collectors/sessionlog/**'],
      outputTokens: 1_640_000,
      ratePerMin: 3_100,
      quietMs: 3_000,
      commits: 4,
      aheadOfMain: 4,
      dirty: 1,
      status: 'working',
      subagents: 5,
      seed: 26,
    },
    {
      // OFF-FENCE — fenced to docs, editing the web package.
      handle: '77-prd3-groom',
      issue: '77',
      fence: ['docs/**', 'prompts/**'],
      outputTokens: 158_000,
      ratePerMin: 110,
      quietMs: 33_000,
      commits: 2,
      aheadOfMain: 2,
      dirty: 1,
      status: 'working',
      subagents: 0,
      strayFiles: ['packages/web/src/App.tsx', 'packages/core/src/state.ts'],
      seed: 27,
    },
    {
      handle: '78-collision-matrix',
      issue: '78',
      fence: ['packages/web/src/panels/collisions/**'],
      outputTokens: 205_000,
      ratePerMin: 130,
      quietMs: 46_000,
      commits: 3,
      aheadOfMain: 3,
      dirty: 2,
      status: 'working',
      subagents: 1,
      seed: 28,
    },
    {
      handle: '79-replay-frame',
      issue: '79',
      fence: ['packages/web/src/replay/**'],
      outputTokens: 88_000,
      ratePerMin: 70,
      quietMs: 95_000,
      commits: 1,
      aheadOfMain: 1,
      dirty: 0,
      status: 'working',
      subagents: 0,
      seed: 29,
    },
    {
      handle: '80-format-shared',
      issue: '80',
      fence: ['packages/web/src/lib/**'],
      outputTokens: 44_000,
      ratePerMin: 55,
      quietMs: 140_000,
      commits: 2,
      aheadOfMain: 2,
      dirty: 0,
      status: 'done',
      subagents: 0,
      seed: 30,
    },
    {
      handle: '81-provenance-bar',
      issue: '81',
      fence: ['packages/web/src/app/**'],
      outputTokens: 121_000,
      ratePerMin: 95,
      quietMs: 62_000,
      commits: 2,
      aheadOfMain: 2,
      dirty: 3,
      status: 'working',
      subagents: 2,
      seed: 31,
    },
    {
      handle: '82-spend-selectors',
      issue: '82',
      fence: ['packages/core/src/selectors/**'],
      outputTokens: 377_000,
      ratePerMin: 175,
      quietMs: 12_000,
      commits: 6,
      aheadOfMain: 6,
      dirty: 1,
      status: 'working',
      subagents: 3,
      seed: 32,
    },
  ]

  return build(now, 'main', specs)
}
