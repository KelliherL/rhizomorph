import { describe, expect, it } from 'vitest'
import { createEvent } from './events/index.js'
import { fixtureSession, makeEvent } from './fixtures.js'
import { eventToLine, eventsToJsonl, lineToEvent, parseJsonl } from './jsonl.js'
import { reduceAll } from './reduce.js'

describe('JSONL round-trip', () => {
  it('survives every event in a whole session, byte for byte', () => {
    const events = fixtureSession()
    const text = eventsToJsonl(events)
    const parsed = parseJsonl(text)
    expect(parsed.errors).toEqual([])
    expect(parsed.events).toEqual(events)
  })

  it('folds to the same state after a trip through the log', () => {
    const events = fixtureSession()
    expect(reduceAll(parseJsonl(eventsToJsonl(events)).events)).toEqual(reduceAll(events))
  })

  it('writes one line per event with no embedded newlines', () => {
    const text = eventsToJsonl(fixtureSession())
    expect(text.endsWith('\n')).toBe(true)
    expect(text.trimEnd().split('\n')).toHaveLength(fixtureSession().length)
  })

  it('keeps a multi-line commit message intact', () => {
    const event = makeEvent('commit.landed', {
      sha: 'c1',
      branch: 'a',
      message: 'feat: thing\n\nWith a body.\nAnd a "quote".',
      author: { name: 'Agent' },
      files: [{ path: 'a.ts', status: 'modified' }],
    })
    const result = lineToEvent(eventToLine(event))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.event).toEqual(event)
  })

  it('produces nothing for no events', () => {
    expect(eventsToJsonl([])).toBe('')
    expect(parseJsonl('')).toEqual({ events: [], errors: [] })
  })
})

describe('lineToEvent', () => {
  const good = createEvent('pane.activity', { paneId: '%1', contentHash: 'h' }, { id: 'e1', ts: 5 })

  it('validates as it reads, rather than trusting the file', () => {
    const result = lineToEvent(eventToLine(good), 3)
    expect(result).toEqual({ ok: true, event: good })
  })

  it('reports a truncated line instead of throwing', () => {
    const line = eventToLine(good).slice(0, 20)
    const result = lineToEvent(line, 7)
    expect(result).toMatchObject({ ok: false, kind: 'json', line, lineNumber: 7 })
    if (result.ok) throw new Error('unreachable')
    expect(result.error.length).toBeGreaterThan(0)
  })

  it('reports a well-formed line that is not an event', () => {
    const result = lineToEvent('{"hello":"world"}', 1)
    expect(result).toMatchObject({ ok: false, kind: 'schema', lineNumber: 1 })
    if (result.ok) throw new Error('unreachable')
    expect(result.error).toContain('type')
  })

  it('reports a valid event type carrying an invalid payload', () => {
    const result = lineToEvent(
      JSON.stringify({ id: 'e1', ts: 1, source: 'git', type: 'commit.landed', payload: { sha: 'c1' } }),
    )
    expect(result).toMatchObject({ ok: false, kind: 'schema', lineNumber: null })
  })

  it.each(['null', '42', '"a string"', '[]'])('rejects the bare JSON value %s', (line) => {
    expect(lineToEvent(line).ok).toBe(false)
  })

  it('calls a blank line blank rather than broken', () => {
    expect(lineToEvent('   ', 2)).toMatchObject({ ok: false, kind: 'empty', lineNumber: 2 })
  })
})

describe('parseJsonl', () => {
  it('steps over a bad line and keeps the good ones, with line numbers', () => {
    const [a, b] = [
      createEvent('collector.error', { collector: 'git', message: 'x' }, { id: 'e1', ts: 1 }),
      createEvent('collector.error', { collector: 'git', message: 'y' }, { id: 'e2', ts: 2 }),
    ]
    const text = [eventToLine(a), '{ this is not json', eventToLine(b)].join('\n')

    const parsed = parseJsonl(text)
    expect(parsed.events).toEqual([a, b])
    expect(parsed.errors).toHaveLength(1)
    expect(parsed.errors[0]).toMatchObject({ kind: 'json', lineNumber: 2 })
  })

  it('ignores blank lines anywhere in the file', () => {
    const event = createEvent('pane.closed', { paneId: '%1' }, { id: 'e1', ts: 1 })
    const parsed = parseJsonl(`\n${eventToLine(event)}\n\n\n`)
    expect(parsed.events).toEqual([event])
    expect(parsed.errors).toEqual([])
  })

  it('tolerates a half-written last line, the way tailing a live log does', () => {
    const event = createEvent('pane.closed', { paneId: '%1' }, { id: 'e1', ts: 1 })
    const parsed = parseJsonl(`${eventToLine(event)}\n{"id":"e2","ts":2,"sou`)
    expect(parsed.events).toEqual([event])
    expect(parsed.errors[0]?.lineNumber).toBe(2)
  })
})
