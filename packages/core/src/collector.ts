import { type EventType, type ObservatoryEvent, type PayloadOf, createEvent } from './events/index.js'

/**
 * The contract between the poll loop (server) and every collector, so neither
 * side has to touch the other's files.
 *
 * A collector is `poll(prevSnapshot) → { nextSnapshot, events[] }`: pure logic
 * over the *output text* of shell commands, with the shelling-out itself
 * pushed behind {@link Exec}. That is what lets collector tests run against
 * captured fixtures with no git, tmux or workmux present.
 */

export interface ExecOptions {
  cwd?: string
  timeoutMs?: number
  env?: Record<string, string>
  /** Stdin to write, for the rare command that wants it. */
  input?: string
}

export interface ExecResult {
  stdout: string
  stderr: string
  /** Exit code, or null if the process was killed by a signal. */
  code: number | null
  /** True for a non-zero exit, a signal, a timeout, or a missing binary. */
  failed: boolean
  /** Set when the binary itself could not be run (ENOENT and friends). */
  errorMessage?: string
}

/**
 * Thin shell wrapper. Argv form, never a shell string — no quoting bugs, and
 * nothing in this app ever needs a shell.
 */
export type Exec = (
  command: string,
  args: readonly string[],
  options?: ExecOptions,
) => Promise<ExecResult>

/** What a collector gets handed on every tick. */
export interface CollectorContext {
  /** Absolute path of the repo being watched. */
  repoPath: string
  /** Epoch millis for this tick. Injectable so tests are deterministic. */
  now: number
  exec: Exec
  /** Session-unique id generator. */
  nextId: () => string
  /**
   * Builds a validated event stamped with `now` and a fresh id. Collectors
   * should use this rather than hand-rolling envelopes.
   */
  emit: <T extends EventType>(type: T, payload: PayloadOf<T>) => ObservatoryEvent
}

export interface PollResult<Snapshot> {
  nextSnapshot: Snapshot
  events: ObservatoryEvent[]
}

/**
 * Generic over its own snapshot type: the loop stores the snapshot opaquely
 * and hands it straight back next tick.
 */
export interface Collector<Snapshot = unknown> {
  /** Stable name, used in `collector.error` / `collector.disabled` payloads. */
  name: string
  /** Snapshot handed to the very first poll. */
  initialSnapshot(): Snapshot
  poll(
    prevSnapshot: Snapshot,
    context: CollectorContext,
  ): Promise<PollResult<Snapshot>> | PollResult<Snapshot>
}

export interface CollectorContextInit {
  repoPath: string
  now: number
  exec: Exec
  nextId: () => string
}

/**
 * Builds the per-tick context. One implementation of `emit` for every
 * collector, so nobody hand-rolls an envelope or skips validation.
 */
export function createCollectorContext(init: CollectorContextInit): CollectorContext {
  return {
    repoPath: init.repoPath,
    now: init.now,
    exec: init.exec,
    nextId: init.nextId,
    emit: (type, payload) => createEvent(type, payload, { id: init.nextId(), ts: init.now }),
  }
}

/**
 * Erased form, for a registry holding collectors with differing snapshot
 * types. `any` rather than `unknown` so an implementation with a concrete
 * snapshot is assignable to it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCollector = Collector<any>
