# @observatory/core

The event contract and every pure derivation over it. Server, collectors and
web all import from here; nothing here imports from them.

```
events → reduce() → SessionState → selectors → panels / scene
```

Import everything from the package root: `import { ... } from '@observatory/core'`.

## Events

One envelope, `{ id, ts, source, type, payload }`, with `ts` in epoch
milliseconds. Twelve v0 types across four sources:

| source | types |
| --- | --- |
| `git` | `worktree.discovered` `worktree.removed` `branch.updated` `commit.landed` `worktree.dirty` |
| `tmux` | `pane.discovered` `pane.closed` `pane.activity` |
| `workmux` | `agent.status` |
| `system` | `session.started` `collector.error` `collector.disabled` |

```ts
const event = createEvent('commit.landed', { sha, branch, message, author, files }, { id, ts })
// source is filled in from the type — see EVENT_SOURCE_BY_TYPE
```

- `createEvent(type, payload, { id, ts })` — validated; **throws** on a bad
  payload, which is the point at the collector boundary.
- `parseEvent(value)` → `{ ok: true, event } | { ok: false, error, issues }` —
  never throws. Use this on anything off the wire.
- `EventOf<T>` / `PayloadOf<T>` for the concrete event and payload of one type.
- `createIdFactory(prefix?)` → `() => 'evt-000001'`.

`worktree.dirty` is a **snapshot**, not a delta: each event replaces that
worktree's whole uncommitted set.

## Collector contract

```ts
interface Collector<Snapshot> {
  name: string
  initialSnapshot(): Snapshot
  poll(prev: Snapshot, ctx: CollectorContext): PollResult<Snapshot> | Promise<PollResult<Snapshot>>
}
// ctx: { repoPath, now, exec, nextId, emit(type, payload) }
// PollResult: { nextSnapshot, events }
```

Shell out only through `ctx.exec` (`Exec`, argv form, never a shell string) and
keep the parsing pure, so tests run against captured fixture text with no git,
tmux or workmux installed. Build events with `ctx.emit` — it stamps `now` and a
fresh id and validates.

## Reducer

`reduce(state, event)` and `reduceAll(events, state?)`, pure and immutable,
starting from `initialSessionState()`. The same function folds the live SSE
stream and a replayed history slice — that is why replay is free.

`SessionState` holds `session`, `mainBranch`, `worktrees`, `branches`,
`commits` + `commitOrder`, `panes`, `agents`, `collectors`, `errors`, and
envelope bookkeeping (`eventCount`, `firstEventTs`, `lastEventTs`). Removed
worktrees and closed panes are marked `present: false` rather than deleted, so
history stays intact.

## Selectors

All pure, all taking `state` first. Panels should consume these and derive
nothing themselves.

- **Worktree table** — `selectWorktreeViews(state, opts?)`,
  `selectWorktreeIndex`, `selectWorktree(state, path)`. Rows arrive with
  panes, agent, dirty set, `filesTouched` and `aheadOfMain` already joined.
  Removed worktrees are excluded unless `includeRemoved: true`.
- **Collisions** — `selectCollisionMap` (every touched file),
  `selectCollisions` (contended only, worst first), `selectCollisionPairs`,
  `selectCollidingBranches`. A touch is uncommitted work in a live worktree, or
  a commit on a branch that main does not have.
- **Liveness** — `selectPaneLiveness(state, { now, flatlineMs?, idleMs? })`,
  `selectPaneLivenessIndex`, `selectFlatlinedPanes`, `selectWorktreeLiveness`.
  `now` is always injected, never read from the clock, so replay agrees with
  live. Threshold defaults to `DEFAULT_FLATLINE_MS` (5 min); statuses are
  `active | idle | flatline | closed | unknown`.
- **Branches** — `selectAheadOfMain`, `selectBranches`, `selectBranchIndex`.
  Prefers git's reported merge-base count, falling back to commits observed
  during the session (`preferReported: false` forces the derived count).
- **Commits** — `selectCommits` (newest first), `selectRecentCommits(state, n)`,
  `selectCommitsForBranch`, `commitDiffStat`.

Every selector accepts `{ mainBranch }` to override what "main" means.

## JSONL

```ts
eventsToJsonl(events)            // newline-terminated document
eventToLine(event)               // one line, no newline
lineToEvent(line, lineNumber?)   // { ok: true, event } | { ok: false, kind, error, line, lineNumber }
parseJsonl(text)                 // { events, errors } — blank lines skipped
```

Reading never throws: a truncated final line is normal when tailing a live
session, so it comes back as an error value to log and step over.

## Test fixtures

```ts
const f = createEventFactory({ startTs, stepMs, idPrefix })
f.worktreeDiscovered({ path, branch, isMain: false })   // partial payload, rest defaulted
f.commitLanded({ sha: 'c1' }, { ts: 1234 })             // pin the clock when it matters
f.all()                                                  // everything it made, in order

fixtureSession()   // a scripted swarm: 4 worktrees, 3 panes, 3 commits,
                   // 2 file collisions, 1 pane silent since t+1m
FIXTURE_NOW        // the `now` to pass to liveness selectors for that session
makeEvent(type, payload, { id?, ts? })  // a validated one-off
```

Fixtures go through the schemas, so a stale fixture fails loudly instead of
propagating a shape that no collector will ever emit.
