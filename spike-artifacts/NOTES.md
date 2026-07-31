# SPIKE A — CONSTELLATION REFINED

Run it: `npm run dev:server` (port 4321) + `npm run dev --workspace packages/web`.
Keys: **1** live · **2** twenty lanes · **3** staged pathologies · **L** replay a
landing streak · **Esc** clear focus.

Screenshots: `1-live.png`, `2-twenty-lanes.png`, `3-staged-pathologies.png`.

---

## The one structural change, and why

**The scene is a fixed 2D dial, not an orbiting 3D camera.**

Everything else here is discipline applied to what we already had. This is the
one thing I changed on purpose, and it is the design statement:

A rotating camera spends three encoding channels on nothing. A lane is never in
the same place twice (so you cannot learn where "72" lives), lanes occlude each
other (so "render everything, always" quietly becomes "render most things"), and
apparent size is perspective, not work. Ruling 1 breaks ties toward
glanceability; on a second monitor, a scene that has to be *watched* to be read
is a scene that is not read. Flat, fixed, and still — a constellation you can
point at.

It is also the honest version of ruling 22: at twenty lanes the dial has twenty
permanent slots and no lane is ever hidden behind another.

## The channels

Nine, each carrying exactly one thing. Nothing decorative touches any of them.

| channel | carries |
|---|---|
| **angle** | lane identity — slot assigned at dispatch order, never moves |
| **bead area** | output tokens, √-scaled |
| **spoke length** | recency: the wire reaches the bead when live, retracts as it goes quiet, with a cut tick and a ghost-dotted gap where it stopped |
| **fill lightness** | recency again (redundant on purpose — it is a first-second read) + a ±5% per-lane identity offset |
| **fence ring** | the lane's fence. On the ring = in your lane |
| **sigil** | the pathology, on *form* before colour |
| **hue** | the ladder, and only the ladder |
| **filaments** | subagent threads, second growth fanned back toward main |
| **halo + reticle** | the summons |

## The five pathologies

Each is separated on form first, so the five survive the colour channel being
taken away (protanopia, a bad monitor, a screenshot in Slack):

- **LOOPING** — a coil of 2.75 turns that visibly passes *inside* where it
  started, terminating in a thorn curl that bites the bead. A cycle, drawn.
- **FROZEN** — hollow ring, **horizontal** flatline bar with end serifs, no
  fill, severed spoke, dimmest thing on screen.
- **WAITING** — a **vertical** tapered arm raised out of a *fully lit* bead,
  capped with a dot and a ring. Live spoke.
- **EXPENSIVE** — a corona of tapered rays and a hot core.
- **OFF-FENCE** — the bead is *outside the fence ring*, its stretch of the fence
  is torn open with thorn-curled ends, and a barbed spear runs through the gap.

**FROZEN and WAITING are deliberately opposite on four channels at once**
(axis, fill, lightness, connection). The brief says they must not resemble each
other; making them differ on one channel would not have been enough.

**OFF-FENCE gets position** — the strongest channel available — because
trespass is the only pathology that is spatial. It needs no legend at all: the
bead is the one object outside the circle.

## The contrast spend

When anything needs the operator, everything that does not steps back to 44%
(NOTICE to 62%). That is the mechanism behind "the single most salient object" —
saliency is a *ratio*, not a colour, and no amount of amber makes a lane
dominant if twelve calm lanes are shouting at full contrast beside it.

EXPENSIVE recedes too. It is a NOTICE, not a summons — so its core stops short
of white and it never out-shines an amber lane, even when it is the biggest bead
on the dial. (In an early pass it was white-hot and it stole the screen from the
frozen lane. That was the bug the contract exists to catch.)

## What I'd steal-proof

Four things I would defend in the rebuild whichever direction wins:

1. **Recency as a retracting wire, not just dimming.** Dim reads as
   "unimportant"; a severed wire with a visible cut reads as "detached from the
   work". It also gives FROZEN a spatial tell for free, and it degrades
   gracefully — at a glance you count the wires that reach.
2. **FROZEN ⊥ WAITING on four channels.** Whatever the visual language, these
   two must be opposed on axis *and* fill *and* lightness *and* connection.
3. **Position for OFF-FENCE.** Any direction can draw a fence and put the
   trespasser outside it. Nothing else gets close for glance speed.
4. **The recede rule.** Attention is a contrast budget; spend it by taking
   contrast *away* from the calm, not by adding more to the alarmed.

Plus one non-visual one: **the ladder floor.** `ALL CLEAR` is now structurally
incapable of printing beside a non-zero collision count — the collision count
raises the rung, and the evidence line only exists at CALM. Ruling 14's
"never bare reassurance" has to be enforced in the model, not remembered in the
view.

## Laws, honestly

- **Law 9 (colour)** — four hues, ladder only. Identity uses lightness, angle,
  shape and label. Every state also carries a glyph and a word.
- **Law 10 (motion)** — the only ambient motion is a 2.2% breathe on live beads.
  LOOPING does **not** spin: it is a state, so its cycle is drawn into the form.
  The one event animation is the landing streak (press `L`), and the attention
  strip pulses once on a new item, then holds steady.
  `prefers-reduced-motion` kills both.
- **Law 11 (type)** — sans for labels, mono + tabular numerals for every number,
  id, branch and timestamp, through the shared formatter.
- **Law 12 (gap voice)** — the footer speaks WHAT → WHY → the command. On live
  data right now it truthfully says `NO COST FEED (OTel) — dollars unavailable`
  and `CONDUCTOR NOT INSTRUMENTED — overhead ratio unknowable`.

## What is real, and what is not

- **Everything downstream of `buildFleet` is real.** All three fixtures are
  schema-validated `ObservatoryEvent` logs folded by the same `reduceAll` and
  the same `@observatory/core` selectors the live stream uses. There is no
  fixture-only render path and nothing says "draw a loop" — the loop is found by
  a cycle detector over `tool.activity`, the freeze by silence, the trespass by
  glob-matching touched files against a fence.
- **The lane manifest is a stand-in.** Ruling 19's `dispatch.sh` does not write
  `.swarm/lanes.json` yet, so live reads `packages/web/public/lanes.json`
  (hand-written, the three spike worktrees). Lanes absent from it show
  `fence: none` and the gap voice says off-fence is undetectable — which is the
  true state of the world today.
- **Detection honesty:** `LaneVital.waitingInferred` exists and renders a `?`,
  but is always false here — workmux *declares* `waiting`, so nothing is
  inferred from pane state. If that ever changes, the flag is already wired.
- **Two tuned constants** are the only judgement calls in the detectors:
  EXPENSIVE is ≥3× the fleet median output rate (floor 120 out/min), and
  FROZEN is 4 minutes of total silence. Both are named constants at the top of
  `fleet.ts`.
- **`spike-c-mycelium` really is looping in `1-live.png`.** That is a sibling
  agent, detected live, not staged.

## Known soft spots

- The right column runs out of rows below ~22 lanes. That space is where ruling
  15's activity feed and ruling 17's lane drawer belong; both are out of this
  brief's scope.
- Lane labels stagger radially to avoid collisions. Past ~28 lanes they will
  start to touch near twelve and six o'clock; the fix is angular label
  suppression for calm lanes, not a smaller font.
- Attention chips wrap if more than ~6 lanes need the operator at once. Beyond
  that the strip should collapse to "N need you" plus the worst three.

## Files

```
packages/web/src/spike/
  fleet.ts        the read: join core selectors → LaneVital, + the five detectors
  fleet.test.ts   the detectors, and the staged fixture's one-of-each claim
  fixtures.ts     the two synthetic event logs
  geom.ts         the stroke engine (tapered ribbons, spirals, thorn curls)
  sigils.tsx      the five marks, at scene scale and at 13px row scale
  Scene.tsx       the dial
  Panels.tsx      attention strip · burn strip · fleet table · provenance footer
  SpikePage.tsx   layout + fixture switching
  spike.css       the tokens
packages/web/scripts/shoot.mjs   the screenshot script
```
