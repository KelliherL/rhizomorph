import { createEventFactory, type ObservatoryEvent } from '@observatory/core'
import type { LaneManifest } from './model/organism.js'

/**
 * Two synthetic logs, both built relative to a `now` handed in at load time so
 * recency, the loop window and the burn window all mean what they say.
 *
 * Fixture 2 exists to test ruling 22 — render everything, always — at twenty
 * lanes with second-generation growth. Fixture 3 stages one of each pathology
 * so the five limb behaviours can be compared side by side in one frame.
 */

const REPO = '/repo/observatory'
const WT = (name: string) => `${REPO}-wt/${name}`
const MINUTE = 60_000

export interface Fixture {
  key: string
  name: string
  events: ObservatoryEvent[]
  manifest?: LaneManifest
}

interface LaneSpec {
  name: string
  /** Output tokens produced inside the burn window. */
  output: number
  /** How long ago this lane last did anything, in minutes. */
  quietFor: number
  status: 'working' | 'waiting' | 'done'
  subagents?: number[]
  cost?: number
  model?: string
  dirty?: string[]
  commits?: { message: string; files: string[] }[]
  /** Tool names to replay, newest last. A repeating tail is a loop. */
  tools?: string[]
}

function buildLog(now: number, lanes: readonly LaneSpec[], repoName: string): ObservatoryEvent[] {
  const f = createEventFactory({ stepMs: 40, idPrefix: 'fx', startTs: now - 40 * MINUTE })

  f.sessionStarted({ sessionId: 'fixture', repoPath: REPO, repoName, mainBranch: 'main' })
  f.worktreeDiscovered({ path: REPO, branch: 'main', head: 'sha-main', isMain: true })

  for (const lane of lanes) {
    f.worktreeDiscovered({
      path: WT(lane.name),
      branch: lane.name,
      head: `sha-${lane.name}`,
      isMain: false,
    })
    f.paneDiscovered({
      paneId: `%${lane.name}`,
      windowName: lane.name,
      currentPath: WT(lane.name),
      worktreePath: WT(lane.name),
    })
  }

  for (const lane of lanes) {
    const last = now - lane.quietFor * MINUTE
    const sessionId = `sess-${lane.name}`
    const model = lane.model ?? 'claude-opus-5'

    for (const [index, commit] of (lane.commits ?? []).entries()) {
      f.commitLanded(
        {
          sha: `sha-${lane.name}-${index}`,
          branch: lane.name,
          worktreePath: WT(lane.name),
          message: commit.message,
          author: { name: lane.name, email: `${lane.name}@swarm` },
          files: commit.files.map((path) => ({
            path,
            status: 'modified' as const,
            insertions: 20,
            deletions: 4,
          })),
          insertions: 20 * commit.files.length,
          deletions: 4 * commit.files.length,
        },
        { ts: last - (index + 2) * 4 * MINUTE },
      )
      f.branchUpdated(
        {
          branch: lane.name,
          worktreePath: WT(lane.name),
          head: `sha-${lane.name}-${index}`,
          aheadOfMain: index + 1,
        },
        { ts: last - (index + 2) * 4 * MINUTE },
      )
    }

    if (lane.dirty !== undefined) {
      f.worktreeDirty(
        {
          path: WT(lane.name),
          branch: lane.name,
          files: lane.dirty.map((path) => ({ path, status: 'modified' as const })),
        },
        { ts: last },
      )
    }

    // Spread the lane's output over the burn window, newest at `last`.
    const requests = 6
    const share = Math.round(lane.output / requests)
    for (let index = 0; index < requests; index += 1) {
      const ts = last - (requests - 1 - index) * 70_000
      f.llmUsage(
        {
          lane: lane.name,
          role: 'worker',
          model,
          tokens: {
            input: 3,
            output: share,
            cacheRead: share * 28,
            cacheCreation: Math.round(share * 0.8),
          },
          requestId: `req-${lane.name}-${index}`,
          durationMs: 7_400,
          sessionId,
          worktreePath: WT(lane.name),
          branch: lane.name,
          thread: 'main',
        },
        { ts },
      )
      if (lane.cost !== undefined) {
        f.llmCost(
          {
            lane: lane.name,
            role: 'worker',
            model,
            costUsd: lane.cost / requests,
            authoritative: true,
            sessionId,
            worktreePath: WT(lane.name),
            branch: lane.name,
            thread: 'main',
          },
          { ts, source: 'otel' },
        )
      }
    }

    for (const [index, output] of (lane.subagents ?? []).entries()) {
      f.llmUsage(
        {
          lane: lane.name,
          role: 'worker',
          model: index % 2 === 0 ? model : 'claude-sonnet-5',
          tokens: { input: 2, output, cacheRead: output * 22, cacheCreation: 400 },
          requestId: `req-${lane.name}-sub-${index}`,
          sessionId,
          worktreePath: WT(lane.name),
          branch: lane.name,
          thread: 'subagent',
        },
        { ts: last - index * 4 * MINUTE },
      )
      if (lane.cost !== undefined) {
        f.llmCost(
          {
            lane: lane.name,
            role: 'worker',
            model,
            costUsd: (lane.cost * 0.2) / (lane.subagents?.length ?? 1),
            authoritative: true,
            sessionId,
            worktreePath: WT(lane.name),
            branch: lane.name,
            thread: 'subagent',
          },
          { ts: last - index * 4 * MINUTE, source: 'otel' },
        )
      }
      f.toolActivity(
        {
          lane: lane.name,
          tool: 'Grep',
          role: 'worker',
          sessionId,
          worktreePath: WT(lane.name),
          branch: lane.name,
          thread: 'subagent',
        },
        { ts: last - index * 4 * MINUTE },
      )
    }

    const tools = lane.tools ?? ['Read', 'Edit', 'Bash']
    for (const [index, tool] of tools.entries()) {
      f.toolActivity(
        {
          lane: lane.name,
          tool,
          role: 'worker',
          sessionId,
          worktreePath: WT(lane.name),
          branch: lane.name,
          thread: 'main',
        },
        { ts: last - (tools.length - 1 - index) * 20_000 },
      )
    }

    f.agentStatus(
      {
        handle: lane.name,
        status: lane.status,
        worktreePath: WT(lane.name),
        branch: lane.name,
        elapsedSeconds: Math.round(lane.quietFor * 60),
        detail: lane.commits?.[0]?.message ?? `${lane.name} lane`,
      },
      { ts: last },
    )
    f.paneActivity(
      { paneId: `%${lane.name}`, contentHash: `h-${lane.name}`, previousHash: 'h-0' },
      { ts: last },
    )
  }

  // The conductor spends too, and it never stops.
  for (let index = 0; index < 8; index += 1) {
    f.llmUsage(
      {
        lane: 'conductor',
        role: 'conductor',
        model: 'claude-sonnet-5',
        tokens: { input: 9, output: 900, cacheRead: 44_000, cacheCreation: 1_100 },
        sessionId: 'sess-conductor',
        thread: 'main',
      },
      { ts: now - index * 45_000 },
    )
  }

  return f.all().sort((a, b) => a.ts - b.ts)
}

/** Twenty lanes, second growth on six of them. Ruling 22's test case. */
export function twentyLaneFixture(now: number): Fixture {
  const names = [
    '12-scene-contract',
    '18-alarm-ladder',
    '21-glyph-grammar',
    '24-attention-strip',
    '27-burn-window',
    '30-fleet-density',
    '33-replay-frame',
    '36-collector-honesty',
    '39-panel-focus',
    '42-lane-manifest',
    '45-thread-rollup',
    '48-branch-ledger',
    '51-run-command',
    '54-doctor',
    '57-provenance-bar',
    '60-instance-identity',
    '63-lane-role',
    '66-ledger-subrows',
    '69-token-semantics',
    '72-stranger-audit',
  ]

  const lanes: LaneSpec[] = names.map((name, index) => {
    return {
      name,
      // A wide spread of work sizes, so limb weight has something to say.
      output: [1_400, 3_600, 8_200, 2_400, 5_200][index % 5] as number,
      // Decorrelated from size on purpose: weight and recency must be legible
      // as two separate readings, not as one.
      quietFor: [0.2, 1.4, 6.5, 0.6, 3.2, 0.9, 2.1][index % 7] as number,
      status: index === 7 ? 'waiting' : index === 3 || index === 16 ? 'done' : 'working',
      ...(index % 3 === 0
        ? { subagents: [2_800, 1_500, 900, 600].slice(0, 2 + (index % 2)) }
        : {}),
      cost: 0.4 + (index % 5) * 0.35,
      ...(index % 4 === 0
        ? { commits: [{ message: `feat(${name}): first pass`, files: [`packages/${name}/src/a.ts`] }] }
        : {}),
      dirty: [`packages/${name}/src/edit.ts`],
    }
  })

  // One lane out in front on burn — the fleet's hot spot.
  const hot = lanes[10] as LaneSpec
  hot.output = 96_000
  hot.cost = 7.4
  hot.quietFor = 0.1
  hot.subagents = [6_200, 4_100, 3_300, 1_800]

  return {
    key: '2',
    name: '20 LANES',
    events: buildLog(now, lanes, 'observatory'),
  }
}

/** One of each pathology, plus healthy lanes to be told apart from. */
export function stagedPathologyFixture(now: number): Fixture {
  const lanes: LaneSpec[] = [
    {
      name: '08-healthy-parser',
      output: 5_200,
      quietFor: 0.3,
      status: 'working',
      cost: 0.62,
      commits: [{ message: 'feat(parse): tokens', files: ['packages/core/src/parse.ts'] }],
      dirty: ['packages/core/src/parse.ts'],
      tools: ['Read', 'Edit', 'Bash', 'Write', 'Read'],
    },
    {
      name: '11-second-growth',
      output: 7_400,
      quietFor: 0.8,
      status: 'working',
      cost: 0.91,
      subagents: [3_400, 2_100, 1_200],
      dirty: ['packages/server/src/api/routes.ts'],
      tools: ['Task', 'Read', 'Edit'],
    },
    {
      // LOOPING: Read → Edit → Bash, four times over, and nothing committed.
      name: '15-retry-storm',
      output: 6_100,
      quietFor: 0.2,
      status: 'working',
      cost: 0.77,
      dirty: ['packages/server/src/collectors/tmux/poll.ts'],
      tools: [
        'Read', 'Edit', 'Bash',
        'Read', 'Edit', 'Bash',
        'Read', 'Edit', 'Bash',
        'Read', 'Edit', 'Bash',
      ],
    },
    {
      // FROZEN: last sign of life eleven minutes ago, still nominally working.
      name: '19-silent-migration',
      output: 3_300,
      quietFor: 11,
      status: 'working',
      cost: 0.41,
      dirty: ['packages/core/src/reduce.ts'],
    },
    {
      // WAITING: workmux says so, in its own words.
      name: '23-needs-a-decision',
      output: 2_900,
      quietFor: 2.4,
      status: 'waiting',
      cost: 0.36,
      dirty: ['docs/prd3.md'],
    },
    {
      // EXPENSIVE: an order of magnitude past the fleet's median burn.
      name: '26-opus-runaway',
      output: 88_000,
      quietFor: 0.1,
      status: 'working',
      cost: 11.2,
      subagents: [9_400, 6_100],
      dirty: ['packages/web/src/panels/ledger/index.tsx'],
    },
    {
      // OFF-FENCE: its fence is packages/cli, its hands are in packages/core.
      name: '31-cli-flags',
      output: 4_800,
      quietFor: 0.5,
      status: 'working',
      cost: 0.58,
      commits: [{ message: 'feat(cli): --since flag', files: ['packages/cli/src/flags.ts'] }],
      dirty: [
        'packages/cli/src/flags.ts',
        'packages/core/src/reduce.ts',
        'packages/core/src/state.ts',
      ],
    },
  ]

  return {
    key: '3',
    name: 'PATHOLOGY',
    events: buildLog(now, lanes, 'observatory'),
    // Declared fences (ruling 19): the manifest is what makes off-fence a fact
    // rather than a guess, so the staged fixture ships one.
    manifest: {
      '08-healthy-parser': ['packages/core/src/parse'],
      '11-second-growth': ['packages/server/'],
      '15-retry-storm': ['packages/server/src/collectors/'],
      '19-silent-migration': ['packages/core/src/reduce'],
      '23-needs-a-decision': ['docs/'],
      '26-opus-runaway': ['packages/web/'],
      '31-cli-flags': ['packages/cli/'],
    },
  }
}
