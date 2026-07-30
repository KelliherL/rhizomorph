import { z } from 'zod'
import { envelope, nonEmptyString } from './common.js'

/** workmux-sourced events. Optional source: absent binary just disables it. */

export const agentStatusSchema = z.enum(['working', 'waiting', 'done'])
export type AgentStatus = z.infer<typeof agentStatusSchema>

export const agentStatusPayloadSchema = z.object({
  /** workmux's handle for the agent — its window/worktree name. */
  handle: nonEmptyString,
  status: agentStatusSchema,
  worktreePath: nonEmptyString.nullable().optional(),
  branch: nonEmptyString.nullable().optional(),
  elapsedSeconds: z.number().int().nonnegative().nullable().optional(),
  detail: z.string().optional(),
})
export type AgentStatusPayload = z.infer<typeof agentStatusPayloadSchema>

export const agentStatusEventSchema = envelope('workmux', 'agent.status', agentStatusPayloadSchema)

export const workmuxEventSchemas = [agentStatusEventSchema] as const
