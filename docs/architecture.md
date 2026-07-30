# Architecture — The Observatory

> **Living document.** Blessed by Lachlan 2026-07-30 before any code. Real
> decisions made during the build get appended, not rewritten.

## Platform

- Node 22, TypeScript strict mode.
- npm-workspaces monorepo:
  - `packages/core` — event schema + pure logic (reducer, selectors)
  - `packages/server` — collectors + API + CLI
  - `packages/web` — Vite + React + Tailwind 4 + react-three-fiber
- Vitest everywhere.
- Exact versions are pinned at scaffold time (issue #1) and recorded here by
  the scaffold worker, not remembered.

## The one structural decision that matters: event-sourced core

Every fact is an event in one append-only log; every consumer reads the same
stream. `packages/core` owns the event envelope and types — zod schemas,
runtime-validated at the collector boundary, inferred TS types everywhere
else:

```ts
{ id, ts, source: 'git' | 'tmux' | 'workmux' | 'system', type, payload }
```

v0 event types:

- **git:** `worktree.discovered/removed` · `branch.updated` (head moved) ·
  `commit.landed` (message, author, diffstat, files) · `worktree.dirty`
  (uncommitted changed-file set — what makes collision warnings *early*,
  before commits exist)
- **tmux:** `pane.discovered/closed` · `pane.activity` (content-hash delta
  per poll)
- **workmux:** `agent.status` (working/waiting/done)
- **system:** `session.started` · `collector.error/disabled`

`core` also owns the **`Collector` interface**, so collectors and the server
loop build against the same contract without touching each other's files.

## Collectors emit raw facts only

Flatline, collisions, "ahead of main" — all *derived* downstream by pure
selectors in `core`, shared by server and web. Collectors stay dumb and
testable; the interesting logic lives where the dense unit tests are; the
same selectors serve live view and replay identically.

## Collector shape

Each collector is `poll(prevSnapshot) → { nextSnapshot, events[] }` — pure
logic over the *output text* of shell commands (`git worktree list
--porcelain`, `git diff --name-status`, `tmux capture-pane`, `workmux
status`), with a thin exec wrapper. Unit tests run the pure part against
captured fixture outputs — no git/tmux needed to test. Poll every 2s; emit
only diffs (snapshot comparison, no tick spam). A missing binary (no workmux,
no tmux) → one `collector.disabled` event; everything else keeps working.

## The log lives outside the watched repo

`~/.local/share/observatory/<repo-slug>/session-<ts>.jsonl`. The read-only
promise means we don't even add a gitignored directory to the target repo.

## Server

Fastify:

- `GET /api/stream` — SSE: replays the session so far from offset, then
  live-tails.
- `GET /api/sessions`, `GET /api/sessions/:id/events` — history for replay.
- `GET /api/meta` — repo name, session info.
- Serves the built web app statically — one origin, no CORS.

CLI entry `observatory [path]` boots collectors + server, prints the URL.

## Web

One SSE hook feeds one reducer (imported from `core`) into React context —
no state library (one tree, one store). **Live and replay are the same
reducer**: live folds the stream as it arrives; replay folds a history slice
under a scrubber clock. That one property is why replay is free.

Panels are sibling directories (`panels/worktrees`, `panels/collisions`,
`panels/ticker`, …), each consuming selectors only. The shell pre-creates
lazy-loaded slots and stub directories for every panel, so panel workers only
ever edit their own directory — that is the file-disjointness that lets three
agents build three panels simultaneously.

## The scene

react-three-fiber, lazy-loaded behind an error boundary, consuming the same
selectors — no bespoke data path. If it breaks, the panel grid stands alone;
the demo survives.

## Testing

Mass on core selectors/reducers and collector parsers (fixtures captured
from real command output). Light render tests on panels. The scene is
verified by eyes, not units — said honestly. Merge gate: `npm test` +
`npm run typecheck` green, enforced mechanically by a workmux `pre_merge`
hook.

## Decisions log

- 2026-07-30 — zod at the collector boundary: runtime validation costs a
  dependency but makes bad parser output loud instead of silent. (Blessed.)
- 2026-07-30 — session logs outside the repo: purist read-only, slightly
  less discoverable. (Blessed.)
- 2026-07-30 — Tailwind 4 for panels: daily fluency, faster worker output,
  one more scaffold dep. (Blessed.)

## Platform — pinned versions (issue #1, 2026-07-30)

| Package | Version |
| --- | --- |
| node (engine) | 22 |
| typescript | 7.0.2 |
| vitest | 4.1.10 |
| zod | 4.4.3 |
| fastify | 5.10.0 |
| vite | 8.1.5 |
| @vitejs/plugin-react | 6.0.4 |
| react | 19.2.8 |
| react-dom | 19.2.8 |
| @types/react | 19.2.17 |
| @types/react-dom | 19.2.3 |
| tailwindcss | 4.3.3 |
| @tailwindcss/vite | 4.3.3 |
| @react-three/fiber | 9.6.1 |
| @react-three/drei | 10.7.7 |
| three | 0.185.1 |
| @types/three | 0.185.1 |
| jsdom | 30.0.1 |
| @testing-library/react | 16.3.2 |
| @testing-library/jest-dom | 7.0.0 |
| tsx | 4.23.1 |
| @types/node | 22.20.1 |
