import { describe, expect, it } from 'vitest'
import { buildFleet, detectCycle, globMatch, type Pathology } from './fleet.js'
import { fixture20, fixtureStaged } from './fixtures.js'

/**
 * The behaviour tests behind the pictures. The staged fixture's claim — one of
 * each pathology, derived rather than declared — is the whole basis of the
 * spike review's pathology clause, so it is asserted here rather than trusted
 * to a screenshot.
 */

const NOW = 1_800_000_000_000

describe('detectCycle', () => {
  it('finds the longest repeating tail cycle', () => {
    const tools = ['Grep', 'Read', 'Edit', 'Bash', 'Read', 'Edit', 'Bash', 'Read', 'Edit', 'Bash']
    expect(detectCycle(tools)).toEqual({ cycle: ['Read', 'Edit', 'Bash'], repeats: 3 })
  })

  it('reports one tool hammered in place as a one-step cycle', () => {
    expect(detectCycle(['Read', 'Bash', 'Bash', 'Bash', 'Bash'])?.cycle).toEqual(['Bash'])
  })

  it('does not see a cycle in varied work', () => {
    expect(detectCycle(['Read', 'Edit', 'Bash', 'Grep', 'Write', 'Read', 'Task'])).toBeNull()
  })

  it('needs three repeats, not two', () => {
    expect(detectCycle(['Read', 'Edit', 'Read', 'Edit'])).toBeNull()
  })
})

describe('globMatch', () => {
  it.each([
    ['packages/web/**', 'packages/web/src/App.tsx', true],
    ['packages/web/**', 'packages/core/src/state.ts', false],
    ['docs/**', 'docs/prd3.md', true],
    ['docs/*.md', 'docs/prd3.md', true],
    ['docs/*.md', 'docs/sub/prd3.md', false],
    ['.github/**', '.github/workflows/ci.yml', true],
    ['package.json', 'package.json', true],
    ['package.json', 'packageXjson', false],
  ])('%s vs %s', (glob, path, expected) => {
    expect(globMatch(glob, path)).toBe(expected)
  })
})

describe('the staged fixture', () => {
  const { events, manifest } = fixtureStaged(NOW)
  const fleet = buildFleet(events, { now: NOW, manifest })

  const withPathology = (pathology: Pathology) =>
    fleet.lanes.filter((lane) => lane.pathologies.includes(pathology)).map((lane) => lane.handle)

  it('derives exactly one lane per pathology', () => {
    expect(withPathology('looping')).toEqual(['73-doctor-states'])
    expect(withPathology('frozen')).toEqual(['74-macos-ci'])
    expect(withPathology('waiting')).toEqual(['75-lane-manifest'])
    expect(withPathology('expensive')).toEqual(['76-transcript-tail'])
    expect(withPathology('off-fence')).toEqual(['77-prd3-groom'])
  })

  it('never calls a lane both frozen and waiting', () => {
    for (const lane of fleet.lanes) {
      expect(lane.pathologies.includes('frozen') && lane.pathologies.includes('waiting')).toBe(
        false,
      )
    }
  })

  it('puts frozen and off-fence on BROKEN, waiting and looping on NEEDS-YOU', () => {
    const rungOf = (handle: string) =>
      fleet.lanes.find((lane) => lane.handle === handle)?.rung ?? null
    expect(rungOf('74-macos-ci')).toBe('broken')
    expect(rungOf('77-prd3-groom')).toBe('broken')
    expect(rungOf('75-lane-manifest')).toBe('needs')
    expect(rungOf('73-doctor-states')).toBe('needs')
    expect(rungOf('76-transcript-tail')).toBe('notice')
  })

  it('reads "waiting since", not "last heard from"', () => {
    const waiting = fleet.lanes.find((lane) => lane.handle === '75-lane-manifest')
    expect(waiting?.ageMs).toBeLessThan(60_000)
    expect(waiting?.sinceMs).toBeGreaterThan(5 * 60_000)
  })

  it('names the off-fence files rather than only counting them', () => {
    const trespasser = fleet.lanes.find((lane) => lane.handle === '77-prd3-groom')
    expect(trespasser?.offFenceFiles).toContain('packages/web/src/App.tsx')
    expect(trespasser?.offFenceFiles).toContain('packages/core/src/state.ts')
  })

  it('reports authoritative dollars and a real burn rate', () => {
    expect(fleet.burn.costAuthoritative).toBe(true)
    expect(fleet.burn.costUsd).toBeGreaterThan(0)
    expect(fleet.burn.costPerHour).toBeGreaterThan(0)
    expect(fleet.burn.outputTokens).toBeGreaterThan(1_000_000)
  })

  it('says the conductor is uninstrumented instead of printing a zero ratio', () => {
    expect(fleet.burn.overheadRatio).toBeNull()
    expect(fleet.gaps.map((gap) => gap.what)).toContain('CONDUCTOR NOT INSTRUMENTED')
  })
})

describe('the twenty-lane fixture', () => {
  const { events, manifest } = fixture20(NOW)
  const fleet = buildFleet(events, { now: NOW, manifest })

  it('renders every lane — ruling 22, nothing culled at scale', () => {
    expect(fleet.lanes).toHaveLength(20)
    expect(fleet.main).not.toBeNull()
  })

  it('stays quiet apart from the staged waiting lane', () => {
    expect(fleet.attention.map((lane) => lane.pathologies)).toEqual([['waiting']])
  })

  it('spreads work size widely enough for the bead scale to mean something', () => {
    const outputs = fleet.lanes.map((lane) => lane.outputTokens)
    expect(Math.max(...outputs) / Math.min(...outputs)).toBeGreaterThan(8)
  })
})

describe('the ladder', () => {
  it('never prints ALL CLEAR over a standing collision', () => {
    const { events, manifest } = fixtureStaged(NOW)
    const fleet = buildFleet(events, { now: NOW, manifest })
    if (fleet.evidence.collisionFiles > 0) expect(fleet.rung).not.toBe('calm')
  })
})
