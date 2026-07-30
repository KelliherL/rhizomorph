import type { Exec, ExecOptions, ExecResult } from './collector.js'
import {
  createEvent,
  createIdFactory,
  type EventEnvelopeInit,
  type EventOf,
  type EventType,
  type ObservatoryEvent,
  type PayloadOf,
} from './events/index.js'

/**
 * Test fixtures, exported from the package so every other package's tests
 * (and the scene, before live data exists) build against the real schemas
 * instead of hand-rolled object literals that drift.
 */

/** 2026-07-30T09:00:00Z — the build day, so fixture timestamps read sensibly. */
export const FIXTURE_START_TS = Date.UTC(2026, 6, 30, 9, 0, 0)

export const FIXTURE_REPO_PATH = '/repo/observatory'

export interface EventFactoryOptions {
  startTs?: number
  /** Milliseconds added to the clock after each event. */
  stepMs?: number
  idPrefix?: string
}

type Init = Partial<EventEnvelopeInit>

/**
 * A deterministic event factory: sequential ids, a clock that ticks per event,
 * and one sugar method per event type taking a partial payload.
 */
export interface EventFactory {
  /** Current clock value, in epoch millis. */
  now(): number
  /** Move the clock to an absolute time. */
  at(ts: number): EventFactory
  /** Move the clock forward. */
  advance(ms: number): EventFactory
  /** Reset clock and id counter. */
  reset(): EventFactory
  /** Every event this factory has produced, in order. */
  all(): ObservatoryEvent[]

  make<T extends EventType>(type: T, payload: PayloadOf<T>, init?: Init): EventOf<T>

  sessionStarted(payload?: Partial<PayloadOf<'session.started'>>, init?: Init): EventOf<'session.started'>
  collectorError(payload?: Partial<PayloadOf<'collector.error'>>, init?: Init): EventOf<'collector.error'>
  collectorDisabled(payload?: Partial<PayloadOf<'collector.disabled'>>, init?: Init): EventOf<'collector.disabled'>
  worktreeDiscovered(payload?: Partial<PayloadOf<'worktree.discovered'>>, init?: Init): EventOf<'worktree.discovered'>
  worktreeRemoved(payload?: Partial<PayloadOf<'worktree.removed'>>, init?: Init): EventOf<'worktree.removed'>
  worktreeDirty(payload?: Partial<PayloadOf<'worktree.dirty'>>, init?: Init): EventOf<'worktree.dirty'>
  branchUpdated(payload?: Partial<PayloadOf<'branch.updated'>>, init?: Init): EventOf<'branch.updated'>
  commitLanded(payload?: Partial<PayloadOf<'commit.landed'>>, init?: Init): EventOf<'commit.landed'>
  paneDiscovered(payload?: Partial<PayloadOf<'pane.discovered'>>, init?: Init): EventOf<'pane.discovered'>
  paneClosed(payload?: Partial<PayloadOf<'pane.closed'>>, init?: Init): EventOf<'pane.closed'>
  paneActivity(payload?: Partial<PayloadOf<'pane.activity'>>, init?: Init): EventOf<'pane.activity'>
  agentStatus(payload?: Partial<PayloadOf<'agent.status'>>, init?: Init): EventOf<'agent.status'>
}

const defaults = {
  'session.started': {
    sessionId: 'session-fixture',
    repoPath: FIXTURE_REPO_PATH,
    repoName: 'observatory',
    mainBranch: 'main',
  },
  'collector.error': { collector: 'git', message: 'git worktree list exited 128' },
  'collector.disabled': { collector: 'workmux', reason: 'workmux not found on PATH' },
  'worktree.discovered': {
    path: FIXTURE_REPO_PATH,
    branch: 'main',
    head: 'sha-main-0',
    isMain: true,
  },
  'worktree.removed': { path: `${FIXTURE_REPO_PATH}-wt/feature` },
  'worktree.dirty': {
    path: `${FIXTURE_REPO_PATH}-wt/feature`,
    branch: 'feature',
    files: [{ path: 'src/a.ts', status: 'modified' }],
  },
  'branch.updated': { branch: 'feature', head: 'sha-feature-1' },
  'commit.landed': {
    sha: 'sha-feature-1',
    branch: 'feature',
    message: 'feat: something',
    author: { name: 'Agent', email: 'agent@example.com' },
    files: [{ path: 'src/a.ts', status: 'modified', insertions: 4, deletions: 1 }],
    insertions: 4,
    deletions: 1,
  },
  'pane.discovered': {
    paneId: '%1',
    windowName: 'feature',
    currentPath: `${FIXTURE_REPO_PATH}-wt/feature`,
    currentCommand: 'node',
    worktreePath: `${FIXTURE_REPO_PATH}-wt/feature`,
  },
  'pane.closed': { paneId: '%1' },
  'pane.activity': { paneId: '%1', contentHash: 'hash-1' },
  'agent.status': { handle: 'feature', status: 'working' },
} as const satisfies { [T in EventType]: PayloadOf<T> }

export function createEventFactory(options: EventFactoryOptions = {}): EventFactory {
  const startTs = options.startTs ?? FIXTURE_START_TS
  const stepMs = options.stepMs ?? 1000
  const idPrefix = options.idPrefix ?? 'evt'

  let clock = startTs
  let nextId = createIdFactory(idPrefix)
  const produced: ObservatoryEvent[] = []

  const make = <T extends EventType>(type: T, payload: PayloadOf<T>, init: Init = {}) => {
    const ts = init.ts ?? clock
    const event = createEvent(type, payload, { id: init.id ?? nextId(), ts })
    if (init.ts === undefined) clock += stepMs
    produced.push(event)
    return event
  }

  const sugar =
    <T extends EventType>(type: T) =>
    (payload: Partial<PayloadOf<T>> = {}, init: Init = {}) =>
      // The spread of a generic partial widens; the schema still validates.
      make(type, { ...(defaults[type] as PayloadOf<T>), ...payload } as PayloadOf<T>, init)

  const factory: EventFactory = {
    now: () => clock,
    at(ts) {
      clock = ts
      return factory
    },
    advance(ms) {
      clock += ms
      return factory
    },
    reset() {
      clock = startTs
      nextId = createIdFactory(idPrefix)
      produced.length = 0
      return factory
    },
    all: () => [...produced],
    make,
    sessionStarted: sugar('session.started'),
    collectorError: sugar('collector.error'),
    collectorDisabled: sugar('collector.disabled'),
    worktreeDiscovered: sugar('worktree.discovered'),
    worktreeRemoved: sugar('worktree.removed'),
    worktreeDirty: sugar('worktree.dirty'),
    branchUpdated: sugar('branch.updated'),
    commitLanded: sugar('commit.landed'),
    paneDiscovered: sugar('pane.discovered'),
    paneClosed: sugar('pane.closed'),
    paneActivity: sugar('pane.activity'),
    agentStatus: sugar('agent.status'),
  }

  return factory
}

/**
 * Shared default factory, for one-off events in a test that does not care
 * about ids or ordering. Call `fx.reset()` in a `beforeEach` if it does.
 */
export const fx: EventFactory = createEventFactory()

/** Build a single validated event with sensible envelope defaults. */
export function makeEvent<T extends EventType>(
  type: T,
  payload: PayloadOf<T>,
  init: Init = {},
): EventOf<T> {
  return createEvent(type, payload, {
    id: init.id ?? `evt-${type}-${init.ts ?? FIXTURE_START_TS}`,
    ts: init.ts ?? FIXTURE_START_TS,
  })
}

export interface StubExecRoute {
  /** Substring of `command arg arg…`, or a predicate for anything fussier. */
  match: string | ((command: string, args: readonly string[]) => boolean)
  /** Defaults to a clean exit with empty output. */
  result?: Partial<ExecResult>
}

export interface StubExecCall {
  command: string
  args: readonly string[]
  options: ExecOptions | undefined
}

export interface StubExec {
  (command: string, args: readonly string[], options?: ExecOptions): Promise<ExecResult>
  /** Every invocation, in order, for asserting what a collector actually ran. */
  calls: StubExecCall[]
}

/**
 * An {@link Exec} backed by canned command output, so collector tests run with
 * no git, tmux or workmux installed. An unmatched command comes back the way a
 * missing binary does — which every collector has to survive anyway.
 */
export function createStubExec(routes: readonly StubExecRoute[] = []): StubExec {
  const calls: StubExecCall[] = []

  const exec = async (command: string, args: readonly string[], options?: ExecOptions) => {
    calls.push({ command, args, options })
    const line = [command, ...args].join(' ')
    const route = routes.find((candidate) =>
      typeof candidate.match === 'string'
        ? line.includes(candidate.match)
        : candidate.match(command, args),
    )

    if (route === undefined) {
      return {
        stdout: '',
        stderr: '',
        code: 127,
        failed: true,
        errorMessage: `no stub for: ${line}`,
      }
    }

    const { result = {} } = route
    const code = result.code === undefined ? 0 : result.code
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      code,
      failed: result.failed ?? (code !== 0),
      ...(result.errorMessage === undefined ? {} : { errorMessage: result.errorMessage }),
    }
  }

  const stub = exec as StubExec
  stub.calls = calls
  return stub
}

/** Compile-time assurance that {@link StubExec} really is an {@link Exec}. */
export const _stubExecIsAnExec: Exec = createStubExec()

const WT = (name: string) => `${FIXTURE_REPO_PATH}-wt/${name}`

/** `now` to pass to liveness selectors when folding {@link fixtureSession}. */
export const FIXTURE_NOW = FIXTURE_START_TS + 10 * 60_000

/**
 * A believable slice of a swarm: four worktrees, three agent panes, commits
 * landing, two file collisions (one dirty-vs-dirty, one dirty-vs-commit), and
 * one pane that went quiet nine minutes ago. Enough for a panel or the scene
 * to look alive before any real data exists.
 */
export function fixtureSession(): ObservatoryEvent[] {
  const f = createEventFactory({ stepMs: 1000 })
  const minute = 60_000

  f.sessionStarted()
  f.worktreeDiscovered({ path: FIXTURE_REPO_PATH, branch: 'main', head: 'sha-main-0', isMain: true })
  f.worktreeDiscovered({ path: WT('2-core'), branch: '2-core', head: 'sha-main-0', isMain: false })
  f.worktreeDiscovered({ path: WT('3-git'), branch: '3-git', head: 'sha-main-0', isMain: false })
  f.worktreeDiscovered({ path: WT('7-web'), branch: '7-web', head: 'sha-main-0', isMain: false })

  f.paneDiscovered({
    paneId: '%1',
    windowName: '2-core',
    currentPath: WT('2-core'),
    worktreePath: WT('2-core'),
  })
  f.paneDiscovered({
    paneId: '%2',
    windowName: '3-git',
    currentPath: WT('3-git'),
    worktreePath: WT('3-git'),
  })
  f.paneDiscovered({
    paneId: '%3',
    windowName: '7-web',
    currentPath: WT('7-web'),
    worktreePath: WT('7-web'),
  })

  f.agentStatus({ handle: '2-core', status: 'working', worktreePath: WT('2-core'), branch: '2-core' })
  f.agentStatus({ handle: '3-git', status: 'working', worktreePath: WT('3-git'), branch: '3-git' })
  f.agentStatus({ handle: '7-web', status: 'working', worktreePath: WT('7-web'), branch: '7-web' })

  // t+1m — everyone is alive.
  f.at(FIXTURE_START_TS + minute)
  f.paneActivity({ paneId: '%1', contentHash: 'h1-a', previousHash: 'h1-0' })
  f.paneActivity({ paneId: '%2', contentHash: 'h2-a', previousHash: 'h2-0' })
  f.paneActivity({ paneId: '%3', contentHash: 'h3-a', previousHash: 'h3-0', preview: 'running tests' })

  // t+2m — first commit lands on 2-core.
  f.at(FIXTURE_START_TS + 2 * minute)
  f.commitLanded({
    sha: 'sha-core-1',
    branch: '2-core',
    message: 'feat(core): event schemas',
    author: { name: 'core agent', email: 'core@example.com' },
    files: [
      { path: 'packages/core/src/events/index.ts', status: 'added', insertions: 120, deletions: 0 },
      { path: 'docs/architecture.md', status: 'modified', insertions: 3, deletions: 1 },
    ],
    insertions: 123,
    deletions: 1,
  })
  f.branchUpdated({ branch: '2-core', head: 'sha-core-1', previousHead: 'sha-main-0', aheadOfMain: 1 })
  f.paneActivity({ paneId: '%1', contentHash: 'h1-b', previousHash: 'h1-a' })

  // t+3m — dirty sets appear. 3-git and 7-web are both editing core's barrel
  // file, and 3-git is editing the doc 2-core already committed.
  f.at(FIXTURE_START_TS + 3 * minute)
  f.worktreeDirty({
    path: WT('3-git'),
    branch: '3-git',
    files: [
      { path: 'packages/server/src/collectors/git/parse.ts', status: 'added' },
      { path: 'packages/core/src/index.ts', status: 'modified' },
      { path: 'docs/architecture.md', status: 'modified' },
    ],
  })
  f.worktreeDirty({
    path: WT('7-web'),
    branch: '7-web',
    files: [
      { path: 'packages/web/src/app/Shell.tsx', status: 'added' },
      { path: 'packages/core/src/index.ts', status: 'modified' },
    ],
  })
  f.paneActivity({ paneId: '%2', contentHash: 'h2-b', previousHash: 'h2-a' })

  // t+4m — second commit on 2-core; the tmux collector hiccups once.
  f.at(FIXTURE_START_TS + 4 * minute)
  f.commitLanded({
    sha: 'sha-core-2',
    branch: '2-core',
    message: 'feat(core): reducer + selectors',
    author: { name: 'core agent', email: 'core@example.com' },
    files: [
      { path: 'packages/core/src/reduce.ts', status: 'added', insertions: 210, deletions: 0 },
      { path: 'packages/core/src/index.ts', status: 'modified', insertions: 6, deletions: 1 },
    ],
    insertions: 216,
    deletions: 1,
  })
  f.branchUpdated({ branch: '2-core', head: 'sha-core-2', previousHead: 'sha-core-1', aheadOfMain: 2 })
  f.collectorError({ collector: 'tmux', message: 'capture-pane timed out', detail: 'pane %3' })

  // t+5m — 3-git commits; %3 has now been silent since t+1m.
  f.at(FIXTURE_START_TS + 5 * minute)
  f.commitLanded({
    sha: 'sha-git-1',
    branch: '3-git',
    message: 'feat(server): git worktree parser',
    author: { name: 'git agent', email: 'git@example.com' },
    files: [
      {
        path: 'packages/server/src/collectors/git/parse.ts',
        status: 'added',
        insertions: 88,
        deletions: 0,
      },
    ],
    insertions: 88,
    deletions: 0,
  })
  f.branchUpdated({ branch: '3-git', head: 'sha-git-1', previousHead: 'sha-main-0', aheadOfMain: 1 })
  f.paneActivity({ paneId: '%1', contentHash: 'h1-c', previousHash: 'h1-b' })
  f.paneActivity({ paneId: '%2', contentHash: 'h2-c', previousHash: 'h2-b' })
  f.agentStatus({ handle: '3-git', status: 'waiting', worktreePath: WT('3-git'), branch: '3-git' })

  return f.all()
}
