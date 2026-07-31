import { SpikePage } from './spike/SpikePage.js'
import type { EventSourceFactory } from './hooks/useEventStream.js'

/**
 * SPIKE A — CONSTELLATION REFINED (prd3, disposable branch).
 *
 * The shell/panel-grid app is bypassed on this branch: the spike is one page,
 * reviewed side by side with spikes B and C. Everything it renders comes from
 * the same validated event stream, through the same `@observatory/core`
 * selectors, as the app it is proposing to replace.
 */

export interface AppProps {
  streamUrl?: string
  /** Test-only escape hatch for injecting a mock SSE source. */
  createSource?: EventSourceFactory
}

export function App({ streamUrl = '/api/stream', createSource }: AppProps = {}) {
  return <SpikePage streamUrl={streamUrl} createSource={createSource} />
}
