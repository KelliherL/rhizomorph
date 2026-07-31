import { act, cleanup, render, screen } from '@testing-library/react'
import { createEvent, createIdFactory } from '@observatory/core'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from './App.js'
import type { EventSourceLike } from './hooks/useEventStream.js'

/**
 * SPIKE A — the page-level smoke test. `App` renders the spike page on this
 * branch (the panel-grid shell it replaces still has its own suites); this
 * covers the wiring the screenshots cannot: the live stream folding into the
 * attention strip, and the fixture keys switching source.
 */

afterEach(cleanup)

class FakeEventSource implements EventSourceLike {
  onopen: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  private readonly named = new Map<string, (event: MessageEvent<string>) => void>()

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.named.set(type, listener)
  }

  removeEventListener(type: string) {
    this.named.delete(type)
  }

  open() {
    this.onopen?.(new Event('open'))
  }

  emit(event: { type: string }) {
    const message = { data: JSON.stringify(event) } as MessageEvent<string>
    this.named.get(event.type)?.(message) ?? this.onmessage?.(message)
  }

  close() {}
}

function renderApp() {
  let source: FakeEventSource | undefined
  const utils = render(
    <App
      createSource={(url) => {
        expect(url).toBe('/api/stream')
        source = new FakeEventSource()
        return source
      }}
    />,
  )
  return { ...utils, source: () => source }
}

const nextId = createIdFactory('evt')

function liveEvents() {
  const now = Date.now()
  return [
    createEvent(
      'session.started',
      { sessionId: 's1', repoPath: '/repo', repoName: 'observatory', mainBranch: 'main' },
      { id: nextId(), ts: now - 1000 },
    ),
    createEvent(
      'worktree.discovered',
      { path: '/repo', branch: 'main', head: 'sha-0', isMain: true },
      { id: nextId(), ts: now - 900 },
    ),
    createEvent(
      'worktree.discovered',
      { path: '/repo-wt/9-thing', branch: '9-thing', head: 'sha-1', isMain: false },
      { id: nextId(), ts: now - 800 },
    ),
    createEvent(
      'agent.status',
      {
        handle: '9-thing',
        status: 'waiting',
        worktreePath: '/repo-wt/9-thing',
        branch: '9-thing',
      },
      { id: nextId(), ts: now - 700 },
    ),
  ]
}

describe('the spike page', () => {
  it('renders the four surfaces and starts with no live data', () => {
    renderApp()

    expect(screen.getByText('the fleet')).toBeInTheDocument()
    expect(screen.getByText('lanes')).toBeInTheDocument()
    expect(screen.getByText('output tok')).toBeInTheDocument()
    expect(screen.getByText(/no live stream/i)).toBeInTheDocument()
  })

  it('folds the live stream and raises the lane that needs the operator', () => {
    const { source } = renderApp()

    act(() => source()?.open())
    for (const event of liveEvents()) act(() => source()?.emit(event))

    expect(screen.getByText('1 NEEDS YOU')).toBeInTheDocument()
    // The lane is named in the strip, the table and the scene — all three read
    // the one model, which is the point of asserting on all of them at once.
    expect(screen.getAllByText('9-thing').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('WAITING').length).toBeGreaterThanOrEqual(2)
  })

  it('switches to the staged fixture on key 3', () => {
    renderApp()

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }))
    })

    expect(screen.getByText(/staged pathologies/)).toBeInTheDocument()
    expect(screen.getByText('4 NEED YOU')).toBeInTheDocument()
  })
})
