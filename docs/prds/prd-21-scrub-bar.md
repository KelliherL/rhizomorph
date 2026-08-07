# prd21 — the scrub bar moves smoothly, reads its position, and opens to the full record at a point

> **Outcome:** proposed 2026-08-07 — not blessed, nothing landed. Two rulings drafted. Both open questions that gated dispatch are now resolved (see "Open questions"); the work is filed as #269–#274, and ruling 1's core half is #267, which this PRD depends on.

**Status:** PROPOSED — operator report 2026-08-07, evidence measured the same
day. Sequenced after prd13 (the TIDE, whose dock this modifies). Numbered 21 at
the operator's direction: prd18 is reserved by `docs/roadmap.md` for the
complete-record UI, and prd19 (the connection) and prd20 (the concierge) are
taken.

**Filed as:** #269 (seek-path coalescing, ruling 1's web half) · #270 (the
1000-notch step) · #271 (the 10 fps playback tick) · #272 (absolute time and
the scattered scrub facts) · #273 (the loupe, ruling 2) · #274
(`buildSessionIndex`'s load cost). **Depends on:** #267 (the incremental spend
cursor, core-only fence).

## Problem

Replay is navigated through a scrubber that is coarse to drag, expensive to
move, quiet about where you are, and unable to show what it captured.

The track snaps between ~1000 discrete notches. Every drag frame recomputes
the entire derived fleet object, synchronously, at a cost that exceeds the
frame budget on every session size measured — including a four-lane one. By
default the bar shows no absolute time and no facts about the scrub instant.
And there is **no way to read the raw events the recording holds at a chosen
moment**: an operator can see *that* a lane landed at 14:32 but not the commit,
the diffstat, the token burst, or the trace span the log captured there. The
dock coalesces everything into four chapter-mark kinds and stops. The full
record is on disk, preserved verbatim (`docs/record-format.md`), and
unreachable through the one surface built to replay it.

## Evidence

Operator report, 2026-08-07: *"not smooth to scroll and info is not displayed
clearly"*, then *"add a zoomability feature to expand on the exact point to
read full data captured."*

**Measured** `[Ran]` 2026-08-07, Node 24, against the real `foldFrom`,
`buildFleet` and core selectors. Log: 447 real events (era-1's own corpus plus
a real recorded session, 16 distinct types), amplified by cloning for the
larger sizes.

Per-seek cost during a simulated 240-seek drag:

| session | `foldFrom` /seek | **`buildFleet` /seek** | vs 16.7 ms frame |
|---|---|---|---|
| 5,000 | 0.003 ms | **26.6 ms** | 159% |
| 25,000 | 0.006 ms | **141.9 ms** | 853% |
| 55,000 | 0.475 ms | **317.9 ms** | 1964% |

**The fold is not the problem, and that overturns the obvious diagnosis.**
#160's keyframed incremental fold is sub-millisecond at every size and holds
up completely. The cost is `buildFleet`, recomputed synchronously on every
seek — roughly 1,000–5,000× the fold. `useReplaySession.ts:178`'s `useMemo`
keys on `playback.currentTs`, so a 120 Hz drag demands 120 full fleet rebuilds
per second. The live event path got animation-frame coalescing in #183; the
seek path never did. React commit and canvas paint sit *on top* of these
numbers, unmeasured.

**Where inside `buildFleet` the cost lives, and what it scales with.** Derived
entities stay constant under amplification — `worktrees=4 branches=4
commits=8 panes=12 agents=3` at 466, 5,000 and 25,000 events alike — while
`telemetry.usage` grows 176 → 1,871 → 9,421 and `telemetry.tools` grows
203 → 2,172 → 10,881. Three spend selectors track those records linearly:

| selector | 466 ev | 5,000 ev | 25,000 ev |
|---|---|---|---|
| `selectLaneSpend` | 2.2 ms | 14.3 ms | 70.7 ms |
| `selectRoleSpend` | 0.8 ms | 7.4 ms | 36.5 ms |
| `selectSessionSpend` | 1.3 ms | 7.3 ms | 35.4 ms |
| `selectWorktreeViews` / `selectCollisions` / `selectTouchesByBranch` | ≤0.06 ms | ≤0.05 ms | ≤0.02 ms |
| **`buildFleet` (whole)** | **6.1 ms** | **58.0 ms** | **292.0 ms** |

So `buildFleet` is **O(telemetry records), not O(lanes)** — and telemetry
records accumulate one per usage or tool event in a real session exactly as
they do here, so the scaling is genuine rather than an artifact of the
amplifier. The geography selectors are irrelevant to the cost. The three named
selectors account for ~22 ms of the 58 ms total at 5,000 events; the remaining
~36 ms is spread across the other ~13 selectors and the draft loop.

**Even unamplified this is over budget.** The real, un-amplified 466-event
session costs **6.1 ms per `buildFleet`** — 37% of one frame — for a session
with four lanes and eight commits.

`buildSessionIndex` at session load costs 34 ms / 234 ms / **4.4 s** at 55,000
events. One-time per session, but real.

**Honest limits.** Node timing; no React commit and no canvas paint measured,
both of which only add. The amplifier fixes the usage-to-total event ratio at
~38%, so a session with a different mix lands elsewhere on the curve. Absolute
figures want confirming against a real long recording or a browser trace. The
*shape* — fold ≪ buildFleet, linear in telemetry records, over budget at every
size including the smallest real one — is robust.

Supporting code anchors: `packages/web/src/replay/Scrubber.tsx:55` (the
1000-notch `step`), `packages/web/src/replay/usePlayback.ts:26`
(`TICK_MS = 100`, a 10 fps playback clock),
`packages/web/src/tide/TideDock.tsx:300` (`showAxis = zoomed`, so absolute
time is hidden by default), `packages/web/src/tide/chapters.ts:63-71` plus
`TideDock.tsx:132-136` (window-zoom reveals only the four-kind glance layer,
capped at `usefulMaxZoomLevel`, never the raw payloads the record preserves).
Design basis: `docs/research/2026-08-05-replay-ux-spike.md`.

## Success

- Dragging a 55,000-event recording holds a smooth cursor: seek → fleet →
  paint coalesced to **one rebuild per animation frame**, and a single rebuild
  itself inside the 16.7 ms budget rather than 20× over it. Demoable by
  scrubbing this project's own longest recording.
- The thumb moves continuously, with no visible notching, at any session
  length.
- At rest and while scrubbing, the bar shows the absolute time at the playhead
  **and** the scrub instant's own headline facts, co-located with the thumb,
  with no zoom required.
- **Zooming onto an exact point opens the loupe: the events the recording
  captured in that neighbourhood, in the record's own order, source/type/payload
  verbatim, down to the individual event — past the mark lane's coalescing
  cap.** Demoable: scrub to a landing, zoom in, and read the actual
  `commit.landed` files and `llm.usage` burst the dock currently draws as one
  dot.
- Playback at 1x advances the scene at frame rate, not in 100 ms steps.

## Non-goals

- The loupe is a transient, portaled read-out — the idiom `ChapterMarks`'
  `MarkHoverCard` already uses — and **not a new panel**. prd13 ruling 1
  holds: the dock is the replay bar's body, never a panel competing with the
  scene.
- Not the lane drawer's job. The drawer is one lane's whole session; the loupe
  is one instant across the whole fleet. It may link *to* the drawer; it never
  duplicates it.
- Not #170's scope-to-selection (ledger and burn-strip windowing). Untouched.
- Not a rewrite of what `buildFleet` derives, and not a reopening of prd3's
  one-object-four-surfaces law. This changes how often and how cheaply it runs.
- No new hue and no new motion class. No mutation of the record to render it.

## Rulings

## Ruling 1 — coalescing is necessary but not sufficient; the spend selectors must stop rescanning

The measured bottleneck is a pure recompute whose cost is linear in
accumulated telemetry records, so **two changes are required and neither alone
suffices.**

Coalescing seek → `buildFleet` to one rebuild per animation frame — the same
remedy #183 applied to the live path and the seek path skipped — removes the
120-rebuilds-per-second waste. But it cannot rescue a single rebuild that
already exceeds the frame budget on its own: 58 ms at 5,000 events, 292 ms at
25,000, and 6.1 ms even on a four-lane session. So the spend selectors must
*also* stop rescanning the whole telemetry history on every call.

**That half is not this PRD's to rule.** The operator ruled it standalone on
2026-08-07 — the cost lands on the live path too, so it is a product-wide
finding the scrubber merely exposed — and it is specified in **#267** (an
incremental spend cursor in `packages/core/src/selectors/spend.ts`), on the
precedent [ADR-0002](../adr/0002-one-reducer-for-live-and-replay.md) and #160's
keyframed cure of the same disease one layer down. Per `AGENTS.md`, an
architectural ruling is linked, not restated: **this PRD depends on #267 and
does not duplicate it.**

**Correction, carried from #267.** An earlier draft of this ruling offered
"memoized per `(state, window)`" as an alternative to incrementalising. That is
a dead end and is explicitly not taken: every seek folds a *fresh* state object
(`useReplaySession.ts:178`), so a state-keyed cache misses 120×/s by
construction — the exact case this PRD exists to fix. The incremental cursor is
the load-bearing fix.

What remains this PRD's own: the web-side half — coalescing the seek path and
threading the cursor through `buildFleet` — whose fence is deliberately
disjoint from #267's core-only one.

The seek must still move the clock immediately: the thumb may never lag the
finger, so the clock update and the fleet rebuild decouple. The fold stays
exactly as #160 built it. Nothing here reopens the append-order law (#205).

## Ruling 2 — the loupe reads the record, it does not re-summarise it

Past the mark lane's `usefulMaxZoomLevel` cap, zoom stops thinning marks and
starts revealing events. The loupe slices the raw `scrubEvents` in a small
neighbourhood of the chosen point and lists them verbatim, in the log's own
append order — never re-sorted (#205), never re-derived into a second summary.

A `Chapter` is deliberately thin (`kind`, `ts`, `lane`, `toolName` —
`chapters.ts:63-71`) and the existing window-zoom only re-lays those coalesced
marks, which is why it is capped at the median event-spacing grain: below it
there are no further marks to separate. The loupe is a second, additive
reading of the same instant. The mark lane's coalescing law and its cap are
untouched.

## Open questions

- ~~The `buildFleet` scope question.~~ **RESOLVED 2026-08-07, operator ruling:
  standalone.** The cost lands on the live path too, so it is a product-wide
  finding rather than a replay one, and it is specified in #267 (core-only
  fence). This PRD depends on it; ruling 1 above carries the consequence.
- ~~Is `buildSessionIndex`'s 4.4 s load cost in scope here?~~ **RESOLVED: its
  own finding**, filed as #274.
- What triggers the loupe — zooming past the cap, a click on the playhead, or
  a dedicated inspect affordance?
- Payload sizes vary by orders of magnitude (a large diffstat against a token
  count). Does the loupe truncate-and-declare, the way `TranscriptEntry`
  carries `dropped`, or hand the heavy ones to the drawer?
- Loupe neighbourhood width: a fixed span in ms, a fixed event count, or the
  zoom level's own window?
- Does the absolute-time readout live inside the scrubber, or become an
  always-on axis (relaxing `showAxis = zoomed`)?
- One PRD or two? The smoothness work and the loupe share the scrub path but
  are independent wins, and either could ship without the other.
