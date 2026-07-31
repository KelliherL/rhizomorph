import type { ObservatoryEvent } from '@observatory/core'

/**
 * The pulse field — the part of this direction that is the direction.
 *
 * **Every pulse is an event.** Not "corresponds to", not "is triggered by
 * activity": one `commit.landed` is one packet of light running home, one
 * `llm.usage` record is one to three motes drifting out to the tip, one
 * `tool.activity` is one tick at the tip or one step of a stuck lane's orbit.
 * Nothing here emits a particle because a particle would look nice. If the
 * fleet stops, the network goes still, and that stillness is information.
 *
 * That is also the tension prd3 ruling 10 warns about: flow *feels* continuous
 * but motion is event-currency. Two rules keep it honest:
 *
 * 1. History does not pulse. A stream replays its whole session on connect, and
 *    those facts are already spent — they build state and light nothing.
 * 2. Traffic is coalesced, never invented. When a lane already has its cap of
 *    motes in flight, further usage records brighten the thread instead of
 *    adding a mote. A busy lane therefore *glows* rather than fibrillating, and
 *    the count it glows for is real.
 */

export type PulseKind = 'commit' | 'mote' | 'tick' | 'landing' | 'trespass'

export interface Pulse {
  id: number
  laneId: string
  kind: PulseKind
  born: number
  life: number
  /** Radius in px at full brightness. */
  size: number
  /** True when it runs node → root-mass. Motes run the other way. */
  homeward: boolean
  /** Set on commits: how many files rode in, for the tail length. */
  weight: number
}

export interface LanePulseState {
  /** Event density, decaying — the thread's living glow. */
  heat: number
  /** Usage records folded into the glow because the mote cap was reached. */
  coalesced: number
  /** A stuck lane's orbit, in laps. Advances one step per tool call, never on its own. */
  orbitPhase: number
  orbitTarget: number
  /** Homeward energy, for the reduced-motion gradient. */
  inbound: number
  /** Outbound (nourishment) energy, for the reduced-motion gradient. */
  outbound: number
}

/** Resolves an event to a lane id in the current fleet, or null if it belongs to none. */
export type LaneResolver = (event: ObservatoryEvent) => string | null

const MAX_PULSES = 720
const MAX_MOTES_PER_LANE = 12

const LIFE: Record<PulseKind, number> = {
  commit: 2_200,
  landing: 2_800,
  mote: 3_400,
  tick: 460,
  trespass: 1_400,
}

/** Heat decays over about six seconds — roughly one agent turn. */
const HEAT_TAU_MS = 6_000
const SURGE_TAU_MS = 950
/** One step of the wheel per tool call: six calls is one lap of the knot. */
const ORBIT_STEP = 1 / 6

export class PulseField {
  private nextId = 1
  private live: Pulse[] = []
  private readonly lanes = new Map<string, LanePulseState>()
  private rootSurge = 0
  private lastStep = 0
  /** Pulses dropped at the cap, for the honesty line in the provenance bar. */
  private dropped = 0

  /** Fold one batch of news. Historical events must never reach this. */
  ingest(events: readonly ObservatoryEvent[], resolve: LaneResolver, now: number): void {
    for (const event of events) this.ingestOne(event, resolve, now)
  }

  private ingestOne(event: ObservatoryEvent, resolve: LaneResolver, now: number): void {
    switch (event.type) {
      case 'commit.landed': {
        const laneId = resolve(event)
        if (laneId === null) {
          // A commit on main itself has no thread to travel: it is already home.
          this.rootSurge = Math.min(1.6, this.rootSurge + 0.9)
          return
        }
        const state = this.state(laneId)
        state.heat += 1.4
        state.inbound += 1
        this.spawn({
          laneId,
          kind: 'commit',
          born: now,
          life: LIFE.commit,
          size: 3.2 + Math.min(3.4, event.payload.files.length * 0.45),
          homeward: true,
          weight: event.payload.files.length,
        })
        return
      }

      case 'worktree.removed': {
        // A landing: the lane's work goes home in one bright surge, and the
        // thread that carried it is about to fold away.
        const laneId = resolve(event)
        if (laneId === null) return
        const state = this.state(laneId)
        state.heat += 2
        state.inbound += 2
        this.spawn({
          laneId,
          kind: 'landing',
          born: now,
          life: LIFE.landing,
          size: 7,
          homeward: true,
          weight: 12,
        })
        return
      }

      case 'llm.usage': {
        const laneId = resolve(event)
        if (laneId === null) return
        const state = this.state(laneId)
        const output = event.payload.tokens.output
        state.heat += 0.55
        state.outbound += 0.6

        // Motes are drift, not spray: one per ~450 output tokens, capped, and
        // whatever the cap swallows becomes glow instead of nothing.
        const wanted = Math.max(1, Math.min(3, Math.round(output / 450)))
        const inFlight = this.live.reduce(
          (count, pulse) => (pulse.laneId === laneId && pulse.kind === 'mote' ? count + 1 : count),
          0,
        )
        const room = Math.max(0, MAX_MOTES_PER_LANE - inFlight)
        const spawn = Math.min(wanted, room)
        if (spawn < wanted) state.coalesced += wanted - spawn

        for (let i = 0; i < spawn; i += 1) {
          this.spawn({
            laneId,
            kind: 'mote',
            born: now + i * 90,
            life: LIFE.mote,
            size: 1.05 + Math.min(1.5, output / 1400),
            homeward: false,
            weight: 0,
          })
        }
        return
      }

      case 'tool.activity': {
        const laneId = resolve(event)
        if (laneId === null) return
        const state = this.state(laneId)
        state.heat += 0.3
        // A looping lane's wheel turns one notch per tool call. If the cycle
        // stops, the orbit stops — the motion is the events, not a spinner.
        state.orbitTarget += ORBIT_STEP
        this.spawn({
          laneId,
          kind: 'tick',
          born: now,
          life: LIFE.tick,
          size: 1.7,
          homeward: false,
          weight: 0,
        })
        return
      }

      default:
        // pane.activity is a heartbeat, llm.cost is the same request the usage
        // record already pulsed for, and a collector fault is chrome, not flow.
        return
    }
  }

  /** One trespass pulse per newly-seen off-fence file — fired by the scene. */
  markTrespass(laneId: string, now: number): void {
    this.spawn({
      laneId,
      kind: 'trespass',
      born: now,
      life: LIFE.trespass,
      size: 2.6,
      homeward: false,
      weight: 0,
    })
  }

  step(now: number): void {
    const dt = this.lastStep === 0 ? 16 : Math.min(240, now - this.lastStep)
    this.lastStep = now

    const survivors: Pulse[] = []
    for (const pulse of this.live) {
      if (now < pulse.born) {
        survivors.push(pulse)
        continue
      }
      if (now - pulse.born < pulse.life) {
        survivors.push(pulse)
        continue
      }
      // A homeward packet reaching the root-mass is the surge — the arrival is
      // the event's end, so the flare cannot happen without the journey.
      if (pulse.homeward) {
        this.rootSurge = Math.min(1.8, this.rootSurge + (pulse.kind === 'landing' ? 1.2 : 0.55))
      }
    }
    this.live = survivors

    const decay = Math.exp(-dt / HEAT_TAU_MS)
    for (const state of this.lanes.values()) {
      state.heat *= decay
      state.inbound *= decay
      state.outbound *= decay
      state.coalesced *= decay
      state.orbitPhase += (state.orbitTarget - state.orbitPhase) * Math.min(1, dt / 260)
    }
    this.rootSurge *= Math.exp(-dt / SURGE_TAU_MS)
  }

  pulses(): readonly Pulse[] {
    return this.live
  }

  lane(laneId: string): LanePulseState {
    return this.lanes.get(laneId) ?? EMPTY_LANE
  }

  surge(): number {
    return this.rootSurge
  }

  droppedCount(): number {
    return this.dropped
  }

  /** Progress 0..1 of a pulse's life, clamped. */
  static progress(pulse: Pulse, now: number): number {
    if (now <= pulse.born) return 0
    const t = (now - pulse.born) / pulse.life
    return t < 0 ? 0 : t > 1 ? 1 : t
  }

  /** Where along the thread it currently sits: 0 = root-mass, 1 = node. */
  static position(pulse: Pulse, now: number): number {
    const t = PulseField.progress(pulse, now)
    return pulse.homeward ? 1 - t : t
  }

  private spawn(pulse: Omit<Pulse, 'id'>): void {
    if (this.live.length >= MAX_PULSES) {
      this.dropped += 1
      return
    }
    this.live.push({ ...pulse, id: this.nextId++ })
  }

  private state(laneId: string): LanePulseState {
    const existing = this.lanes.get(laneId)
    if (existing !== undefined) return existing
    const created: LanePulseState = {
      heat: 0,
      coalesced: 0,
      orbitPhase: 0,
      orbitTarget: 0,
      inbound: 0,
      outbound: 0,
    }
    this.lanes.set(laneId, created)
    return created
  }
}

const EMPTY_LANE: LanePulseState = {
  heat: 0,
  coalesced: 0,
  orbitPhase: 0,
  orbitTarget: 0,
  inbound: 0,
  outbound: 0,
}
