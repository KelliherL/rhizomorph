# SPIKE C — MYCELIUM PULSE-NETWORK

Direction C of the prd3 spike round. Disposable branch `spike-c-mycelium`;
never merges. The one page lives at `packages/web/src/spike/`, rendered by
`packages/web/src/main.tsx`. The shipped shell (`App.tsx`, `app/`, `panels/`,
`scene/`) is untouched, so the old and new pages can be diffed side by side.

## Run it

```bash
observatory                      # in the repo root, if one isn't already up on :4321
npx vite --port 5188             # from packages/web
```

`1` / `2` / `3` switch fixtures. `Esc` clears the spotlight. Clicking a lane
node or a fleet row spotlights it; clicking an attention chip jumps to it.

| key | fixture | source |
|-----|---------|--------|
| `1` | LIVE | `/api/stream` SSE, proxied to the running `observatory` server. Real collectors, real commits, real tokens. |
| `2` | 20-LANE | synthetic, 20 lanes with subagent threads. Ruling 22's scale test. |
| `3` | PATHOLOGY | synthetic, one lane per pathology plus healthy neighbours. |

Screenshots: `1-live.png`, `2-fleet20.png`, `3-pathology.png`, and
`4-pathology-reduced-motion.png` (same fixture under
`prefers-reduced-motion: reduce`).

Both synthetic fixtures are built from **real schema events** through
`createEvent`, folded by core's real `reduce`, and read by core's real selectors.
What is simulated is the fleet; what is not simulated is any part of the path
from event to pixel.

`npx vitest run packages/web/src/spike` — 22 tests over the detectors and the
fixtures. They assert that each pathology is *found in the events*, and that the
20-lane fleet is ALL CLEAR because nothing is wrong with it.

---

## The encodings

Two things break the near-monochrome quiet, and only two: **light**, which is
always an event in flight, and the **ladder hues**, which only ever appear on a
fault's own sigil. Everything else — which lane, how big, how fresh — is carried
by lightness, shape, position and label. That is what keeps ruling 9 intact
while still letting an expensive thread run *white-hot*: white is lightness at
its ceiling, not a fifth hue.

### Structure

| fact | encoding |
|------|----------|
| main | the **root-mass** — a dense tangle of curls at the centre, not a disc |
| the conductor's own burn | the root-mass's resting glow (prd2: orchestration is not free) |
| a lane | a **thread** from the root-mass rim to a node, tapering root→tip like a hypha |
| **work size** (output tokens) | thread width, log-scaled against the fleet's busiest lane; node size; and the mono figure under the label |
| **recency** | **distance from the root-mass.** A lane that just spoke is pulled in tight; as it falls silent its node drifts out and its thread stretches thin. |
| subagent threads | **second-growth filaments** splitting off the parent thread, finer, ending in thorn curls |
| subagent *volume* | number of finer hyphae in a filament bundle (see honesty note below) |
| a lane's fence | its angular **wedge** at the rim, with boundary posts |
| lanes near each other | **bundled** — neighbours leave the rim together and fan apart, so 20 threads read as a network rather than a starburst |

The recency-as-distance choice is the one I'd defend hardest. On the live
fixture it does the whole job in one glance: one bright thick thread close to
the centre, seventeen faint ones drifted out to the rim. "One thing is alive,
it's the biggest, everything else is finished" — with no text read at all.

### Flow

| event | pulse |
|-------|-------|
| `commit.landed` | a **packet of light running home**, node → root-mass, with a tapered wake; size from the file count. Its arrival *is* the root-mass surge. |
| `worktree.removed` | a **landing**: a bigger packet home and a brighter flare |
| `llm.usage` | **motes** drifting outward, root → tip: nourishment going to the growing edge. One per ~450 output tokens, capped at 12 in flight per lane. |
| `tool.activity` | a **tick** at the tip — a flick where the work is. It never travels. |
| `pane.activity` | nothing. It is a heartbeat; it moves the recency clock and lights nothing. |
| `llm.cost` | nothing. It is the same request the usage record already pulsed for. |

Nourishment out, commits home. The two directions are what make the picture
read as *flow* rather than as decoration, and both are literally true of the
data.

### The five pathologies

Node sigils carry the ladder hue; thread behaviour carries the fault's identity.
Neither is load-bearing alone.

| pathology | rung | mark |
|-----------|------|------|
| **LOOPING** | needs-you (amber) | a **knot** tied into the thread — a closed circuit with crossed tails — and a pulse orbiting it, coming back to where it started. The orbit advances **one notch per `tool.activity`**, so a loop that stops looks stopped. |
| **FROZEN** | broken (magenta-red) | the thread **goes dark and breaks** — dashed, near-black — with two magenta-red **cut strokes across it** and a hollow node. Absence of light, plus a severing mark. |
| **WAITING** | needs-you (amber) | a bright amber pulse **held at the node**, breathing in place, plus a **raised hand**: an upright stroke with a rounded cap, always pointing up the screen. The thread behind it stays lit. |
| **EXPENSIVE** | notice (cyan) | the thread runs **white-hot** — blown-out core, wide halo — with cyan rising chevrons at the tip. |
| **OFF-FENCE** | needs-you (amber) | a **rogue filament**, barbed and dashed, leaving the node and reaching into a neighbour's ground — through a dashed amber **fence arc drawn around the victim's node**. |

Frozen and waiting are the pair the brief singles out, so they are separated on
three axes at once: darkness vs light, broken line vs continuous line, and cut
vs raised. And the detectors refuse to emit both for the same silence — one
piece of quiet means one thing (`fleet.test.ts` asserts it).

### Salience

At NEEDS-YOU and above the worst lane gets a **spotlight**: it keeps full
brightness, its label goes into a hued chip, it gains a halo ring, and every
other thread drops to 30%. That makes it the single most salient object *by
construction* rather than by out-shouting its neighbours. A collision never
takes the spotlight — it belongs to a pair of branches, not to one lane, so
spotlighting half of it would name the wrong culprit.

---

## Pulse-as-event vs the motion law

This was the real work of the spike, and the brief was right to flag it. Three
rules hold the line:

**1. History does not pulse.** A stream replays its whole session on connect —
10k events on the live fixture. Firing a pulse for each spent fact would be a
fireworks display, not an instrument. The feed tags every event with whether it
is *news* (judged by its own `ts` against the moment we connected, not by
arrival order), and only news reaches the pulse layer. History builds state and
lights nothing.

**2. Traffic is coalesced, never invented.** A lane with 12 motes already in
flight does not get a 13th; the surplus becomes thread *glow* instead. So a busy
lane glows rather than fibrillating, and the count it glows for is real. Nothing
anywhere spawns a particle because a particle would look nice.

**3. Ongoing states glow; they do not travel.** The two motion treatments that
persist — the looping orbit and the waiting throb — are both *light*, not
travel, and the orbit only moves when a tool call arrives.

Where I deliberately spent motion beyond the letter of ruling 10:

- **The waiting throb** breathes on a 1.2 s cycle. The scene contract demands
  waiting "pulse in place like a raised hand" and demands it not resemble
  frozen; a static bright dot is a weaker distinction. I took the contract's
  side. Under reduced motion it becomes a static bright dot plus the raised-hand
  glyph, which still differs from frozen on darkness *and* on line-break.
- **Recency drift** is a slow interpolation of node position. It is a state
  change rendered as a glide, not ambient animation — the amplitude is minutes,
  so nothing is perceptibly moving. Under reduced motion it still glides, since
  a node teleporting once per second would be worse for a motion-sensitive
  reader than a node creeping.
- **The root-mass breathes** at ±1.6%, which ruling 10 explicitly allows as the
  scene's one ambient motion. Off under reduced motion.

`prefers-reduced-motion` replaces travelling pulses with a **standing brightness
gradient** per thread: bright at the root-mass for homeward traffic, bright at
the tip for nourishment going out, driven by the same decaying event energy. Same
facts, same directions, no movement. See `4-pathology-reduced-motion.png`.

**Verdict on the tension: it holds, and pulse-as-event turned out to be a
*feature* of the law rather than a fight with it.** The best moment in the build
was realising that a commit's arrival surge cannot be faked — the flare happens
when a packet's life ends at the root-mass, so there is no surge without a
journey and no journey without a commit. Stillness became information: on the
live fixture at 20:00, with one lane awake, the network is almost motionless and
that is the honest reading of the fleet.

---

## Detection honesty

Every pathology is derived from recorded facts, and each one says what it read:

- **LOOPING** — a repeating tool cycle (period 2–6, ≥3 repeats) in the trailing
  4 minutes *and* no commit in that window. A single tool repeated is explicitly
  not a loop: exploring reads the same file twice. Evidence line names the
  cycle: `Read→Edit→Bash ×6, no commit`.
- **FROZEN** — no events for 8 minutes, with nobody saying `done`. A lane whose
  agent reported `done` is finished, and a removed worktree has landed; neither
  is reported as a fault. This matters on the live fixture, where 17 of 18 lanes
  are done and none of them is accused of anything.
- **WAITING** — certain when workmux declared it; otherwise inferred from the
  pane still moving while telemetry has gone quiet, and **marked inferred** with
  a `~` in both the chip and the table (ruling 18's honesty clause).
- **EXPENSIVE** — output-tokens/minute over the trailing window, ≥3× the fleet
  median and above a floor. Reports the multiple it found.
- **OFF-FENCE** — recently-touched files (commits not on main, plus dirty files)
  against `.swarm/lanes.json` fence globs, naming the lane whose fence claims
  the file. A file claimed by nobody is still a trespass but has no victim named.

Where the data does not support a claim, the page says so instead of guessing:

- **No lane manifest on the live stream.** Dispatch does not write
  `.swarm/lanes.json` yet, so off-fence detection is *unavailable* on fixture 1
  and the gap voice says exactly that, with the command that fixes it. Fences
  are never inferred from lane names — a wrong fence accuses an innocent lane.
  Fixtures 2 and 3 ship a manifest, which is how off-fence is demonstrable at all.
- **No cost feed on the live stream.** The SPEND cell reads `— no feed` rather
  than a confident `$0.00`, and the rate cell falls back to output tokens/minute.
- **Threads the source didn't name** render as `unk`, never folded into `main`.
  You can see this on the live fixture: `71-token-vocabulary` shows `unk 670`.
- **Filament strand count** encodes subagent request *volume*, not distinct
  subagents. The log never names individual subagent threads, so a strand count
  that implied otherwise would be an invented number. Called out here because it
  is the one place in the scene where a countable-looking thing is not a count.

---

## What I'd steal-proof

If another direction wins, these are the pieces I think should survive it. Ranked.

1. **Recency as distance from the centre.** Cheap, continuous, needs no legend,
   and it makes a finished fleet and a working fleet look categorically
   different at a glance. It is the single highest-value idea in this spike and
   it is layout-agnostic — it works on beads, on limbs, on anything radial.
2. **Pulse-as-event as a hard rule, with the three enforcement mechanisms**
   (history doesn't pulse; coalesce, never invent; arrival is the end of a
   journey). Any direction that animates anything needs all three, and the
   news-vs-history tag in particular is not obvious until a replay burst hits it.
3. **Hue for status, light for life.** Making pulses colourless was the decision
   that let the ladder keep its four hues honestly. It also means adding a new
   event kind never needs a new colour.
4. **The spotlight instead of competing emphasis.** Dimming the other 19 threads
   to 30% is a stronger answer to "single most salient object" than any amount
   of brightening one, and it degrades gracefully to 20 lanes.
5. **The gap voice on the provenance bar, and the always-on collision evidence
   line.** `collisions 22 — checked 19 branches / 73 files` costs one line and
   removes the whole "is this zero real?" question.
6. **One derived object behind all four surfaces.** `buildFleet` is read by the
   strip, the burn strip, the table and the scene, so they cannot disagree about
   how many lanes are working. This is a structural point, not a visual one, and
   it is the thing I would insist on regardless of which direction wins.
7. **Frozen vs waiting separated on three axes** (dark/light, broken/continuous,
   cut/raised) rather than on hue alone. Whatever the winning vocabulary, one
   axis is not enough for this pair.
8. **`done` as a first-class non-pathological state.** Without it, the live
   fixture reports 17 frozen lanes and the whole instrument cries wolf.

---

## What did not work, and the falsifiable bits

- **Rim territory wedges are weak.** They read as ambient substrate but never as
  "this lane's ground". The off-fence encoding only became legible once I drew a
  dashed fence arc *around the victim's node* and put the rogue filament through
  it — the breach needs to be marked where both parties are visible, not out at
  a rim where nothing happened. The wedges stayed in as faint substrate; I would
  not fight for them.
- **Filaments are thinner than the brief hoped.** The log distinguishes exactly
  three thread kinds (`main`/`subagent`/`auxiliary`), so a lane can have at most
  two branching filaments. The "second growth" look comes from strand bundles
  within a filament, which is volume and not identity. Richer generational
  structure needs the collectors to name individual subagent threads — a data
  change, not a design one.
- **Ruling 22 (render everything, always) passes at 20 lanes** — see
  `2-fleet20.png`. All 20 threaded, all labelled, all figures legible, no
  overlap; the bundling is what makes it work rather than the count being small.
  I would expect it to hold to roughly 30 and to start failing on *label*
  collisions near the top and bottom of the ellipse well before the threads
  themselves become unreadable. Labels are the constraint, not the network.
- **The attention strip clips past four named items.** Chips are capped at four
  with a `+N` counter rather than allowed to run off the edge. On the pathology
  fixture that means EXPENSIVE — the only NOTICE — is the one counted rather
  than named, which is correct triage but does mean the strip alone never shows
  all five at once. The scene shows all five simultaneously; the table names all
  five.
- **Canvas 2D was the right call** and I would keep it: ~45 pulses, 20 tapered
  ribbons and 40 filament strands at 60 fps, with full control over pulse
  timing, and no three.js in the bundle. The taper is drawn as a single filled
  polygon per thread rather than as a stroke, which is what makes hyphae look
  like hyphae.

## Where the code is

```
packages/web/src/spike/
  SpikeApp.tsx            the page; fixture switching, tab signal, spotlight policy
  spike.css               chrome tokens: two type families, four hues, nothing else
  data/fleet.ts           the one derived object — lanes, pathologies, ladder, gaps
  data/fleet.test.ts      22 tests: the detectors find what the events describe
  data/fences.ts          lane manifest, glob matcher, off-fence
  feed/live.ts            fixture 1: the real SSE stream, news-vs-history tagging
  fixtures/synthetic.ts   fixtures 2 and 3, built from real schema events
  scene/geometry.ts       layout: recency→radius, size→width, bundling, knots, rogues
  scene/pulses.ts         the pulse field — every pulse is an event
  scene/render.ts         all drawing: root-mass, threads, sigils, pathology marks
  scene/palette.ts        why the mycelium is bone-grey and the pulses have no hue
  ui/                     attention strip, burn strip, fleet table, provenance bar
```

`packages/core` and `packages/server` are untouched — read-only imports only.
