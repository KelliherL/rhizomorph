# SPIKE B — THE SIGIL ORGANISM

Disposable spike for prd3 ruling 24. One page, real data, three sources.

```
npm run dev:web        # serves the spike page; /api proxies to a running observatory
# keys: 1 live · 2 twenty-lane fixture · 3 staged pathologies · esc clears selection
# ?fixture=2 / ?fixture=3 also work, for screenshots
```

Screenshots in this directory: `live.png`, `twenty-lanes.png`,
`twenty-lanes-selected.png` (thread sub-rows open), `pathology.png`.

Everything is SVG. No three.js, no canvas, no layout library — the force field
(`render/force.ts`), the stroke vocabulary (`render/sigil.ts`) and the glyph
alphabet (`render/glyphs.ts`) are ~600 lines of pure geometry, and the data
layer (`model/organism.ts`) folds the same `SessionState` every other consumer
reads. 18 behaviour tests in `model/organism.test.ts` pin the detections.

---

## The encodings

**Work size → limb width + node radius.** Output tokens, scaled `^0.38` against
the fleet maximum (flatter than √ on purpose: one 100K-token runaway must not
squash nineteen other lanes to the floor). A lane's base limb width and its node
radius move together, so mass reads at any zoom without a number.

**Recency → luminance + thorn count.** Fresh growth is bright and barbed; a lane
that has gone quiet fades along a 12-minute ramp and *loses its thorns* as it
goes. Two channels for one variable, both pre-attentive. Labels sit outside the
ramp — a limb may fade, its name must stay readable.

**Limb length is deliberately not an encoding.** It is varied by a hash of the
lane id. Without that the field is a wheel; with it, the thing looks grown.

**Generations → filaments off the *limb*, not off the node.** A subagent run
branches from the parent tendril at ~75% of its length, so second growth reads
as growth rather than as another edge. One filament per *run* (consecutive
non-`main` thread records, split on a 3-minute gap) — the log carries `thread`
but no subagent id, so back-to-back subagents merge into one filament. That
undercounts, which is the safe direction; it is stated in the code.

**Status → hue, and hue only.** `calm` neutral, `notice` cyan, `needs-you`
amber, `broken` magenta-red (`render/palette.ts`). Because calm is neutral by
law, the neon has to come from luminance: calm is a cold near-white (`#b3c6de`)
that glows against the void without owning a colour.

**Salience → the alarm never fades and never dims.** When anything is on
needs-you or above, the calm field drops to 70% and notice to 75%, while alarms
are pinned at full brightness *and* exempt from the recency ramp — FROZEN is old
by definition, so letting recency reach it would hide the loudest thing on the
page. Alarms are also the only nodes that get a **cartouche**: a thorned
enclosing ring. Nothing else on the page is ever bracketed.

## The five pathologies, as limb behaviour

| | what the limb does | glyph | rung |
|---|---|---|---|
| LOOPING | leaves its line, circles twice, arrives where it already was | closed circuit round the stem, thorn biting inward | needs-you |
| FROZEN | stops curving: a straight run in three brittle shards, greyed to necrotic | snapped stem + flatline bar, butt caps, no taper | broken |
| WAITING | last third lifts and arrives at the node from *underneath*, still rising | three splayed prongs off a raised wrist, open upward | needs-you |
| EXPENSIVE | thickens and bristles — dense heat spines the whole length | eight-ray burst | notice |
| OFF-FENCE | the node is dragged bodily toward the territory it is touching, and a barbed reach hooks that lane's rim | stem crossing three fence-posts | needs-you |

Three of the five share amber. That is the point: **hue teaches severity, form
teaches kind.** A coil, a raised hand and a grapple are not confusable at any
distance, and the ladder stays a four-value scale instead of a five-colour code
that would break ruling 9.

Two deliberate separations the brief called out:

- FROZEN vs WAITING — straight/closed/downward/grey against
  curved/open/upward/amber. They share no property.
- FROZEN greys *and* is broken-red — the limb is dead tissue (necrotic grey),
  the node carries the alarm hue. The corpse is grey; the alarm is red.

The **grapple** is the one lane-to-lane stroke in the whole vocabulary. Every
other line runs core→lane or lane→its own growth, so a stroke between two lanes
can only mean trespass. Off-fence needs a fence: the staged fixture ships a lane
manifest (ruling 19); live has none yet, so fences are *inferred* from where a
lane has already committed and the lane records `fenceDeclared: false`. Nothing
is accused without a fence to trespass over.

## The core

`main` as a breathing glyph-heart: three rings, a bound inner mark, and **one
notch per lane** — the core is literally made of the fleet, so it grows a denser
crown as the swarm grows. Its 5.4s breath is the only ambient motion on the
page (ruling 10), and `prefers-reduced-motion` stops it.

## Laws

- **Motion**: the breath, plus a single 900ms pulse when a lane is selected.
  The force field is run to rest on a topology change and then *held* — Obsidian
  floatiness in the shape, not in the frame rate.
- **Type**: sans for labels, mono + `tabular-nums` for every number, branch, id
  and age; `OBSERVATORY` is the only display voice.
- **Gap voice**: live has no OTel feed, so spend renders `—` and the strip says
  `NO COST FEED (OTel) — dollars unavailable — run: eval "$(observatory env
  <lane>)"`. Never `$0.00`.
- **Evidence**: ALL CLEAR carries `N lanes · M branches · K files checked ·
  collisions 0`.
- **Tab signal**: title flips to `● N need you` and the favicon takes the worst
  rung's hue, driven off the same list the attention strip renders.

## How the render-everything ruling held up at 20 lanes

**It held — but only because of four decisions, and it is not free.**

1. **Auto-fit the frame.** The viewBox is computed from the settled bounds, so
   four lanes and forty both arrive framed; more lanes just means a smaller
   scale. No zoom control, no LOD.
2. **Anisotropic gravity.** Vertical pull is ~6× horizontal, which flattens the
   field into a wide oval that fills a landscape frame. Without this the
   organism is a circle in a 16:9 hole and a third of the pixels are wasted.
3. **Generous collision clearance** (`r₁+r₂+34`). A node's *ornament* — coil,
   cartouche, label — lives well outside its radius, so discs that merely fail
   to overlap still read as collided.
4. **Filaments clamped to their parent.** A second-generation node shoved across
   the field by a big neighbour reads as a lane of its own and stretches the
   frame around empty space. Hard limit at 1.45× its link distance.

What actually degrades, honestly:

- **Labels are the first thing to break, not the limbs.** At 20 lanes every name
  is readable; the collision model does not know about text boxes, so a few
  labels sit close to a neighbour's limb. Past ~35 lanes I would expect real
  label collisions before I would expect limb confusion.
- **Glyph detail compresses.** At the 20-lane scale a calm lane's sigil is ~24px
  across. The five pathology marks stay distinguishable (they differ in
  silhouette, not in fine detail) but the *calm* mark becomes decorative rather
  than readable — which is fine, since calm is the state you are not looking for.
- **The live fixture is the harder test, not the synthetic one.** 18 lanes, most
  of them retired, one 18-minute flatline. Retired lanes render at half
  luminance with a sealed-ring glyph and effectively become texture; the four
  live lanes and the one alarm are what you see. That behaviour — a long session
  where most lanes are done — is what will decide whether this scales, and it is
  what the `live.png` shot shows.

Verdict: **no top-N needed at this range.** If it fails, it will fail on labels
first, and the cheap answer is labels-on-hover past a count threshold — which is
a smaller retreat than hiding lanes.

## What I would steal-proof

Things I would keep even if another direction wins:

1. **The fleet table's STATE column renders the scene's own glyph.** Same code,
   15px. That *is* the legend: a reader learns the alphabet from the rows and
   then reads it in the field, which is how the scene gets away with having no
   key. Any winning scene should do this.
2. **Hue = severity, form = kind.** It keeps the ladder to four values under
   ruling 9 while giving five (or fifty) distinguishable conditions. The
   alternative — a colour per pathology — breaks the colour law on day one.
3. **Alarms are exempt from every fade.** Recency dimming and salience dimming
   both skip needs-you and broken. Without this, "frozen" — the one state
   defined by being old — is the dimmest thing on screen.
4. **Detections carry their evidence into the strip.** `Read→Edit→Bash ×4, no
   commit` and `touching 19-silent-migration — 1 file` rather than `LOOPING` and
   `OFF-FENCE`. The attention strip is where the operator decides whether to
   care; a label is not enough to decide with.
5. **One lane-to-lane stroke, reserved.** Keeping the graph strictly
   core→lane→growth means any cross-link is automatically meaningful. Cheap
   grammar, high payoff.
6. **Ornament that erodes.** Thorns as a recency channel costs nothing, looks
   alive, and gives the eye a second reading of the same fact.

Things I would *not* defend:

- The filament burst heuristic. It is the best the current log supports, but a
  real subagent id (a small collector change) would replace it and be strictly
  better.
- WAITING's detection depends on workmux's word. When there is no agent record
  the lane reports `stopped (pane signal only)` — honest, but a lane with
  neither signal simply never raises its hand.
- The organism does not yet animate its settle. Growing a new limb on
  `worktree.discovered` is an event, so it would be lawful, and it would be
  lovely. It was cut for screenshot determinism, not for principle.
