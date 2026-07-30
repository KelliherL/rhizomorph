import { beforeEach, describe, expect, it } from 'vitest'
import { createEventFactory } from '../fixtures.js'
import { reduceAll } from '../reduce.js'
import { initialSessionState } from '../state.js'
import {
  commitDiffStat,
  selectCommits,
  selectCommitsForBranch,
  selectRecentCommits,
} from './commits.js'

let f = createEventFactory()
beforeEach(() => {
  f = createEventFactory()
})

describe('commit ticker selectors', () => {
  const state = reduceAll([
    f.commitLanded({ sha: 'c1', branch: 'a', message: 'first' }, { ts: 100 }),
    f.commitLanded({ sha: 'c2', branch: 'b', message: 'second' }, { ts: 100 }),
    f.commitLanded({ sha: 'c3', branch: 'a', message: 'third' }, { ts: 200 }),
  ])

  it('returns commits newest first', () => {
    expect(selectCommits(state).map((c) => c.sha)).toEqual(['c3', 'c2', 'c1'])
  })

  it('breaks ties within a poll by observation order, not by chance', () => {
    // c1 and c2 share a timestamp; c2 was seen second, so it shows first.
    expect(selectCommits(state).slice(1).map((c) => c.sha)).toEqual(['c2', 'c1'])
  })

  it('limits the ticker', () => {
    expect(selectRecentCommits(state, 2).map((c) => c.sha)).toEqual(['c3', 'c2'])
    expect(selectRecentCommits(state, 0)).toEqual([])
    expect(selectRecentCommits(state, -5)).toEqual([])
    expect(selectRecentCommits(state)).toHaveLength(3)
  })

  it('filters by branch, including a commit that landed on two', () => {
    const merged = reduceAll([...[], f.commitLanded({ sha: 'c1', branch: 'a' }), f.commitLanded({ sha: 'c1', branch: 'main' })])
    expect(selectCommitsForBranch(merged, 'a').map((c) => c.sha)).toEqual(['c1'])
    expect(selectCommitsForBranch(merged, 'main').map((c) => c.sha)).toEqual(['c1'])
    expect(selectCommitsForBranch(merged, 'nope')).toEqual([])
  })

  it('is empty for an empty log', () => {
    expect(selectCommits(initialSessionState())).toEqual([])
  })
})

describe('commitDiffStat', () => {
  it('uses the totals git gave us', () => {
    const state = reduceAll([
      f.commitLanded({
        sha: 'c1',
        files: [{ path: 'a.ts', status: 'modified', insertions: 1, deletions: 1 }],
        insertions: 40,
        deletions: 2,
      }),
    ])
    expect(commitDiffStat(selectCommits(state)[0]!)).toEqual({ files: 1, insertions: 40, deletions: 2 })
  })

  it('falls back to summing the files when it did not', () => {
    const state = reduceAll([
      f.commitLanded({
        sha: 'c1',
        files: [
          { path: 'a.ts', status: 'modified', insertions: 3, deletions: 1 },
          { path: 'b.ts', status: 'added', insertions: 9 },
        ],
        insertions: undefined,
        deletions: undefined,
      }),
    ])
    expect(commitDiffStat(selectCommits(state)[0]!)).toEqual({ files: 2, insertions: 12, deletions: 1 })
  })
})
