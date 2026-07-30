import { z } from 'zod'

/**
 * Scaffold compatibility shim.
 *
 * `packages/server/src/app.ts` and `packages/web/src/App.tsx` still import
 * this from the scaffold (issue #1), and both live outside this issue's fence.
 * The server (#6) and web shell (#7) replace those files; this goes with them.
 *
 * @deprecated Delete once no package imports it.
 */
export const placeholderSchema = z.object({
  ready: z.boolean(),
})

/** @deprecated See {@link placeholderSchema}. */
export type Placeholder = z.infer<typeof placeholderSchema>

/** @deprecated See {@link placeholderSchema}. */
export function placeholder(): Placeholder {
  return { ready: true }
}
