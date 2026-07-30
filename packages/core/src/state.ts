import type {
  AgentStatus,
  Author,
  DirtyFile,
  FileChange,
} from './events/index.js'

/**
 * The fold of an event log. Everything here is *recorded fact*, arranged for
 * lookup; anything derived (flatline, collisions, ahead-of-main) lives in
 * selectors so live view and replay compute it identically.
 */

export interface SessionInfo {
  sessionId: string
  repoPath: string
  repoName: string
  startedAt: number
}

export interface WorktreeState {
  /** Absolute path — the identity of a worktree. */
  path: string
  /** Basename, for display. */
  name: string
  branch: string | null
  head: string | null
  isMain: boolean
  detached: boolean
  /** False once `worktree.removed` has been seen; the record is kept for replay. */
  present: boolean
  discoveredAt: number
  removedAt: number | null
  /** Full current uncommitted set, replaced wholesale by each `worktree.dirty`. */
  dirtyFiles: DirtyFile[]
  dirtyUpdatedAt: number | null
}

export interface BranchState {
  name: string
  head: string | null
  previousHead: string | null
  worktreePath: string | null
  /** As reported by the git collector's merge-base maths, when available. */
  aheadOfMain: number | null
  behindMain: number | null
  /** Shas observed on this branch, in the order they were observed. */
  commits: string[]
  firstSeenAt: number
  updatedAt: number
}

export interface CommitRecord {
  sha: string
  /** A sha can land on several branches — e.g. when a branch merges to main. */
  branches: string[]
  message: string
  author: Author
  /** Author date when git reported it, else the time we saw it land. */
  authoredAt: number
  /** Envelope ts of the first sighting — the ticker's ordering key. */
  landedAt: number
  parents: string[]
  files: FileChange[]
  insertions: number | null
  deletions: number | null
  worktreePath: string | null
}

export interface PaneState {
  paneId: string
  sessionName: string | null
  windowName: string
  windowIndex: number | null
  currentPath: string | null
  currentCommand: string | null
  worktreePath: string | null
  present: boolean
  discoveredAt: number
  closedAt: number | null
  /**
   * Last sign of life: discovery, or any content-hash delta since. Liveness
   * measures against this, so a pane found seconds ago is not born flatlined.
   */
  lastActivityTs: number
  /** Last *content* change specifically — null for a pane that never moved. */
  lastContentChangeTs: number | null
  contentHash: string | null
  activityCount: number
  preview: string | null
}

export interface AgentState {
  handle: string
  status: AgentStatus
  previousStatus: AgentStatus | null
  worktreePath: string | null
  branch: string | null
  elapsedSeconds: number | null
  detail: string | null
  firstSeenAt: number
  updatedAt: number
}

export interface CollectorState {
  name: string
  status: 'error' | 'disabled'
  errorCount: number
  lastErrorTs: number | null
  lastErrorMessage: string | null
  disabledReason: string | null
  disabledAt: number | null
}

export interface ErrorRecord {
  eventId: string
  ts: number
  collector: string
  message: string
  detail: string | null
}

export interface SessionState {
  session: SessionInfo | null
  /** Branch everything is measured against; null until we learn it. */
  mainBranch: string | null
  worktrees: Record<string, WorktreeState>
  branches: Record<string, BranchState>
  commits: Record<string, CommitRecord>
  /** Shas in first-sighting order — the commit ticker reads this. */
  commitOrder: string[]
  panes: Record<string, PaneState>
  agents: Record<string, AgentState>
  collectors: Record<string, CollectorState>
  /** Most recent last, capped — a long session must not grow unbounded. */
  errors: ErrorRecord[]
  eventCount: number
  firstEventTs: number | null
  lastEventTs: number | null
}

/** How many collector errors to keep. Older ones fall off the back. */
export const MAX_ERRORS = 200

export function initialSessionState(): SessionState {
  return {
    session: null,
    mainBranch: null,
    worktrees: {},
    branches: {},
    commits: {},
    commitOrder: [],
    panes: {},
    agents: {},
    collectors: {},
    errors: [],
    eventCount: 0,
    firstEventTs: null,
    lastEventTs: null,
  }
}

/** Basename without pulling in node:path — this module runs in the browser too. */
export function basename(path: string): string {
  const parts = path.split('/').filter((part) => part.length > 0)
  return parts[parts.length - 1] ?? path
}
