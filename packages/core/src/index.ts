import { z } from 'zod'

export const placeholderSchema = z.object({
  ready: z.boolean(),
})

export type Placeholder = z.infer<typeof placeholderSchema>

export function placeholder(): Placeholder {
  return { ready: true }
}
