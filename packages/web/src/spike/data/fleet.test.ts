import { describe, expect, it } from 'vitest'
import { reduceAll } from '@observatory/core'
import { fleet20Spec, manifestFor, pathologySpec, SyntheticFleet } from '../fixtures/synthetic.js'
import { buildFleet, findCycle, type Fleet, type PathologyKind } from './fleet.js'
import { findTrespasses, globMatches, type LaneManifest } from './fences.js'

/**
 * The scene's whole claim is that a pathology is *derived from recorded facts*,
 * not asserted by a fixture. These tests hold that claim to account: they build
 * the fixtures' event logs, fold them through core's real reducer, and check that
 * the detectors find what the events describe — and, just as importantly, that
 * they stay quiet on the fleet where nothing is wrong.
 */

function fleetFor(spec: ReturnType<typeof pathologySpec>): Fleet {
  const now = Date.UTC(2026, 6, 31, 12, 0, 0)
  const fleet = new SyntheticFleet(spec, 0x51ce)
  const state = reduceAll(fleet.history(now))
  return buildFleet(state, { now, manifest: manifestFor(spec) })
}

function kindsFor(fleet: Fleet, laneId: string): PathologyKind[] {
  const lane = fleet.lanes.find((candidate) => candidate.id === laneId)
  expect(lane, `lane ${laneId} is missing from the fleet`).toBeDefined()
  return (lane?.pathologies ?? []).map((pathology) => pathology.kind)
}

describe('the staged-pathology fixture', () => {
  const fleet = fleetFor(pathologySpec())

  it('renders every lane — ruling 22, at any count', () => {
    expect(fleet.lanes).toHaveLength(pathologySpec().lanes.length)
  })

  it('finds exactly one lane per pathology', () => {
    const counts = new Map<PathologyKind, number>()
    for (const lane of fleet.lanes) {
      for (const pathology of lane.pathologies) {
        counts.set(pathology.kind, (counts.get(pathology.kind) ?? 0) + 1)
      }
    }
    expect(Object.fromEntries(counts)).toEqual({
      frozen: 1,
      looping: 1,
      waiting: 1,
      expensive: 1,
      'off-fence': 1,
    })
  })

  it('flags the right lane for each', () => {
    expect(kindsFor(fleet, '42-otel-receiver')).toContain('frozen')
    expect(kindsFor(fleet, '41-retry-parser')).toContain('looping')
    expect(kindsFor(fleet, '43-drawer-attach')).toContain('waiting')
    expect(kindsFor(fleet, '44-scene-pulses')).toContain('expensive')
    expect(kindsFor(fleet, '45-ledger-subrows')).toContain('off-fence')
  })

  it('never calls the same silence both frozen and waiting', () => {
    for (const lane of fleet.lanes) {
      const kinds = lane.pathologies.map((pathology) => pathology.kind)
      expect(kinds.includes('frozen') && kinds.includes('waiting')).toBe(false)
    }
  })

  it('ranks frozen as BROKEN and the rest of the stuck ones as NEEDS-YOU', () => {
    expect(fleet.lanes.find((lane) => lane.id === '42-otel-receiver')?.rank).toBe('broken')
    expect(fleet.lanes.find((lane) => lane.id === '41-retry-parser')?.rank).toBe('needs-you')
    expect(fleet.lanes.find((lane) => lane.id === '43-drawer-attach')?.rank).toBe('needs-you')
    expect(fleet.lanes.find((lane) => lane.id === '45-ledger-subrows')?.rank).toBe('needs-you')
    // A burn outlier is a notice, not an interruption.
    expect(fleet.lanes.find((lane) => lane.id === '44-scene-pulses')?.rank).toBe('notice')
    expect(fleet.rank).toBe('broken')
  })

  it('names the trespassed lane, not just the trespass', () => {
    const offender = fleet.lanes.find((lane) => lane.id === '45-ledger-subrows')
    expect(offender?.trespasses.map((trespass) => trespass.victim)).toContain('46-spend-selectors')
  })

  it('reports waiting as declared rather than inferred, since workmux said so', () => {
    const waiting = fleet.lanes
      .find((lane) => lane.id === '43-drawer-attach')
      ?.pathologies.find((pathology) => pathology.kind === 'waiting')
    expect(waiting?.inferred).toBe(false)
    expect(waiting?.evidence).toBe('workmux reports waiting')
  })

  it('puts a lane in the ladder for each fault, with the collision as one item', () => {
    const kinds = fleet.attention.map((item) => item.kind)
    expect(kinds).toEqual(expect.arrayContaining(['frozen', 'looping', 'waiting', 'off-fence']))
    expect(kinds.filter((kind) => kind === 'collision').length).toBeLessThanOrEqual(1)
  })
})

describe('the 20-lane fixture', () => {
  const fleet = fleetFor(fleet20Spec())

  it('threads all twenty lanes', () => {
    expect(fleet.lanes).toHaveLength(20)
  })

  it('is ALL CLEAR — the detectors find nothing because nothing is staged', () => {
    expect(fleet.lanes.flatMap((lane) => lane.pathologies)).toEqual([])
    expect(fleet.rank).toBe('calm')
    expect(fleet.attention).toEqual([])
  })

  it('earns its calm state with evidence, never bare reassurance', () => {
    expect(fleet.evidence.lanes).toBe(20)
    expect(fleet.evidence.branchesChecked).toBeGreaterThan(20)
    expect(fleet.evidence.filesChecked).toBeGreaterThan(0)
    expect(fleet.evidence.collisions).toBe(0)
  })

  it('sprouts second-generation filaments where a subagent thread spent tokens', () => {
    const withSubagents = fleet.lanes.filter((lane) =>
      lane.filaments.some((filament) => filament.thread === 'subagent'),
    )
    expect(withSubagents.length).toBeGreaterThan(3)
    for (const lane of withSubagents) {
      // Filaments partition the lane, so a sub-thread can never exceed its parent.
      const sub = lane.filaments.find((filament) => filament.thread === 'subagent')
      expect(sub?.outputTokens).toBeLessThanOrEqual(lane.outputTokens)
    }
  })

  it('has dollars from the authority collector', () => {
    expect(fleet.totals.costIsAuthoritative).toBe(true)
    expect(fleet.gaps.map((gap) => gap.what)).not.toContain('NO COST FEED (OTel)')
  })
})

describe('findCycle', () => {
  it('finds the shortest repeating tail', () => {
    const seq = ['Grep', 'Read', 'Edit', 'Bash', 'Read', 'Edit', 'Bash', 'Read', 'Edit', 'Bash']
    expect(findCycle(seq)).toEqual({ pattern: ['Read', 'Edit', 'Bash'], repeats: 3 })
  })

  it('refuses a one-tool run — reading the same file twice is not a loop', () => {
    expect(findCycle(['Read', 'Read', 'Read', 'Read', 'Read', 'Read', 'Read'])).toBeNull()
  })

  it('refuses a sequence that never repeats', () => {
    expect(findCycle(['Read', 'Edit', 'Bash', 'Grep', 'Write', 'Glob'])).toBeNull()
  })

  it('needs three turns of the wheel, not two', () => {
    expect(findCycle(['Read', 'Edit', 'Read', 'Edit'])).toBeNull()
    expect(findCycle(['Read', 'Edit', 'Read', 'Edit', 'Read', 'Edit'])).toEqual({
      pattern: ['Read', 'Edit'],
      repeats: 3,
    })
  })
})

describe('fence globs', () => {
  it('keeps ** across separators and * inside one', () => {
    expect(globMatches('packages/core/**', 'packages/core/src/a.ts')).toBe(true)
    expect(globMatches('packages/*/index.ts', 'packages/core/index.ts')).toBe(true)
    expect(globMatches('packages/*/index.ts', 'packages/core/src/index.ts')).toBe(false)
  })

  it('lets `a/**` match `a` itself', () => {
    expect(globMatches('docs/**', 'docs/prd3.md')).toBe(true)
    expect(globMatches('docs/**/x.md', 'docs/x.md')).toBe(true)
  })

  const manifest: LaneManifest = {
    a: { handle: 'a', fence: ['packages/web/**'], issue: null, model: null },
    b: { handle: 'b', fence: ['packages/core/**'], issue: null, model: null },
  }

  it('names the single lane whose fence claims the file', () => {
    expect(findTrespasses(manifest, 'a', ['packages/core/src/x.ts'])).toEqual([
      { path: 'packages/core/src/x.ts', victim: 'b' },
    ])
  })

  it('still reports a trespass no other lane claims, with no victim named', () => {
    expect(findTrespasses(manifest, 'a', ['README.md'])).toEqual([
      { path: 'README.md', victim: null },
    ])
  })

  it('says nothing about a lane with no fence in the manifest', () => {
    expect(findTrespasses(manifest, 'c', ['packages/core/src/x.ts'])).toEqual([])
  })
})
