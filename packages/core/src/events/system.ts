import { z } from 'zod'
import { envelope, nonEmptyString } from './common.js'

/** system-sourced events: the session itself, and collectors misbehaving. */

export const sessionStartedPayloadSchema = z.object({
  sessionId: nonEmptyString,
  repoPath: nonEmptyString,
  repoName: nonEmptyString,
  /** Branch everything is measured against. Falls back to the main worktree's branch. */
  mainBranch: nonEmptyString.nullable().optional(),
})
export type SessionStartedPayload = z.infer<typeof sessionStartedPayloadSchema>

export const collectorErrorPayloadSchema = z.object({
  collector: nonEmptyString,
  message: z.string(),
  detail: z.string().optional(),
})
export type CollectorErrorPayload = z.infer<typeof collectorErrorPayloadSchema>

/** Emitted once when a source is unavailable (no tmux, no workmux). */
export const collectorDisabledPayloadSchema = z.object({
  collector: nonEmptyString,
  reason: z.string(),
})
export type CollectorDisabledPayload = z.infer<typeof collectorDisabledPayloadSchema>

export const sessionStartedEventSchema = envelope(
  'system',
  'session.started',
  sessionStartedPayloadSchema,
)
export const collectorErrorEventSchema = envelope(
  'system',
  'collector.error',
  collectorErrorPayloadSchema,
)
export const collectorDisabledEventSchema = envelope(
  'system',
  'collector.disabled',
  collectorDisabledPayloadSchema,
)

export const systemEventSchemas = [
  sessionStartedEventSchema,
  collectorErrorEventSchema,
  collectorDisabledEventSchema,
] as const
