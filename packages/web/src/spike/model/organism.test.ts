import { describe, expect, it } from 'vitest'
import { reduceAll } from '@observatory/core'
import { stagedPathologyFixture, twentyLaneFixture } from '../fixtures.js'
import { buildOrganism, type Lane, type Organism, type Pathology } from './organism.js'

/**
 * The staged fixture exists to be pointed at, so these assert that each
 * pathology is actually *detected* — the scene can only encode what the model
 * found, and a glyph drawn from a wrong reading is worse than no glyph.
 */

const NOW = Date.UTC(2026, 6, 31, 12, 0, 0)

function staged(): Organism {
  const fixture = stagedPathologyFixture(NOW)
  return buildOrganism(reduceAll(fixture.events), {
    now: NOW,
    ...(fixture.manifest === undefined ? {} : { manifest: fixture.manifest }),
  })
}

function lane(organism: Organism, id: string): Lane {
  const found = organism.lanes.find((entry) => entry.id === id)
  if (found === undefined) throw new Error(`no lane ${id}`)
  return found
}

describe('the staged pathology fixture', () => {
  const organism = staged()

  const cases: [string, Pathology][] = [
    ['15-retry-storm', 'looping'],
    ['19-silent-migration', 'frozen'],
    ['23-needs-a-decision', 'waiting'],
    ['26-opus-runaway', 'expensive'],
    ['31-cli-flags', 'off-fence'],
  ]

  it.each(cases)('%s is %s', (id, pathology) => {
    expect(lane(organism, id).pathologies).toContain(pathology)
  })

  it('gives each sick lane exactly the one pathology it was staged with', () => {
    for (const [id, pathology] of cases) {
      expect(lane(organism, id).pathologies).toEqual([pathology])
    }
  })

  it('leaves the healthy lanes alone', () => {
    expect(lane(organism, '08-healthy-parser').pathologies).toEqual([])
    expect(lane(organism, '11-second-growth').pathologies).toEqual([])
  })

  it('names the loop it found rather than just flagging one', () => {
    expect(lane(organism, '15-retry-storm').loop).toEqual({
      cycle: ['Read', 'Edit', 'Bash'],
      repeats: 4,
    })
  })

  it('says whose territory the off-fence lane is in', () => {
    const trespasser = lane(organism, '31-cli-flags')
    expect(trespasser.trespassInto).toBe('19-silent-migration')
    expect(trespasser.trespassPaths).toContain('packages/core/src/reduce.ts')
    // Declared fence, not an inferred one — the manifest is what makes it a fact.
    expect(trespasser.fenceDeclared).toBe(true)
  })

  it('puts every alarm on the attention strip, and nothing else', () => {
    expect(organism.attention.map((item) => item.pathology).sort()).toEqual([
      'frozen',
      'looping',
      'off-fence',
      'waiting',
    ])
  })

  it('ranks broken above needs-you', () => {
    expect(organism.attention[0]?.laneId).toBe('19-silent-migration')
  })

  it('grows one filament per subagent run, not one per thread bucket', () => {
    const parent = lane(organism, '11-second-growth')
    expect(parent.filaments).toHaveLength(3)
    expect(parent.filaments.map((f) => f.thread)).toEqual(['subagent', 'subagent', 'subagent'])
    // Sized by output, dearest first — the scene reads them straight off.
    expect(parent.filaments.map((f) => f.outputTokens)).toEqual([3_400, 2_100, 1_200])
  })
})

describe('the twenty-lane fixture', () => {
  const fixture = twentyLaneFixture(NOW)
  const organism = buildOrganism(reduceAll(fixture.events), { now: NOW })

  it('renders every lane — ruling 22 has no top-N', () => {
    // Twenty worktree lanes plus the conductor's own.
    expect(organism.lanes).toHaveLength(21)
  })

  it('finds exactly one burn outlier, so "hot" still means something', () => {
    const hot = organism.lanes.filter((entry) => entry.pathologies.includes('expensive'))
    expect(hot.map((entry) => entry.id)).toEqual(['45-thread-rollup'])
  })

  it('sprouts second growth on the lanes that dispatched subagents', () => {
    const withGrowth = organism.lanes.filter((entry) => entry.filaments.length > 0)
    expect(withGrowth.length).toBeGreaterThanOrEqual(6)
  })

  it('has no dollars missing: the fixture ships an authoritative cost feed', () => {
    expect(organism.burn.costGap).toBeNull()
    expect(organism.burn.costKnown).toBe(true)
  })
})

describe('honesty', () => {
  it('reports unknown dollars as a gap, never as zero', () => {
    const fixture = stagedPathologyFixture(NOW)
    // Strip every cost event: tokens without dollars is the live-baseline case.
    const events = fixture.events.filter((event) => event.type !== 'llm.cost')
    const organism = buildOrganism(reduceAll(events), { now: NOW })
    expect(organism.burn.costKnown).toBe(false)
    expect(organism.burn.costGap).toMatch(/NO COST FEED/)
  })

  it('never accuses a lane of trespass without a fence to trespass over', () => {
    const fixture = stagedPathologyFixture(NOW)
    // No manifest, and the lane's own commits are its only inferred territory.
    const organism = buildOrganism(reduceAll(fixture.events), { now: NOW })
    for (const entry of organism.lanes) {
      if (entry.trespassInto === null) continue
      expect(entry.fenceDeclared).toBe(false)
    }
  })
})
