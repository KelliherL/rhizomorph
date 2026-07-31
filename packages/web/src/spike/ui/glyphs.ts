import type { LadderRank, LaneActivity, PathologyKind } from '../data/fleet.js'

/**
 * One glyph vocabulary for the whole page.
 *
 * The colour law says hue is never the sole carrier, so every state also has a
 * mark — and the mark in the fleet table is the same *idea* as the sigil the
 * scene draws at that lane's node: a knot for a loop, a cut for a frozen thread,
 * a raised stroke for a held hand. Reading one teaches the other, which is how
 * the scene gets to skip a legend.
 */

export const PATHOLOGY_GLYPH: Record<PathologyKind, string> = {
  looping: '⟲',
  frozen: '⊗',
  waiting: '⇧',
  expensive: '⌁',
  'off-fence': '⤳',
}

export const PATHOLOGY_WORD: Record<PathologyKind, string> = {
  looping: 'LOOPING',
  frozen: 'FROZEN',
  waiting: 'WAITING',
  expensive: 'EXPENSIVE',
  'off-fence': 'OFF-FENCE',
}

export const ACTIVITY_GLYPH: Record<LaneActivity, string> = {
  working: '◆',
  waiting: '⇧',
  quiet: '◇',
  done: '⊟',
  unknown: '·',
}

export const ACTIVITY_WORD: Record<LaneActivity, string> = {
  working: 'working',
  waiting: 'waiting',
  quiet: 'quiet',
  done: 'done',
  unknown: 'unknown',
}

export const EXTRA_GLYPH = {
  collision: '⇄',
  collector: '⚑',
} as const

/** CSS class carrying the rung's hue. Defined once, in spike.css. */
export const RANK_CLASS: Record<LadderRank, string> = {
  calm: 'rank-calm',
  notice: 'rank-notice',
  'needs-you': 'rank-needs-you',
  broken: 'rank-broken',
}

export const LADDER_WORD: Record<LadderRank, string> = {
  calm: 'ALL CLEAR',
  notice: 'NOTICE',
  'needs-you': 'NEEDS YOU',
  broken: 'BROKEN',
}

export function glyphFor(kind: PathologyKind | 'collision' | 'collector'): string {
  if (kind === 'collision') return EXTRA_GLYPH.collision
  if (kind === 'collector') return EXTRA_GLYPH.collector
  return PATHOLOGY_GLYPH[kind]
}

export function wordFor(kind: PathologyKind | 'collision' | 'collector'): string {
  if (kind === 'collision') return 'COLLISION'
  if (kind === 'collector') return 'COLLECTOR'
  return PATHOLOGY_WORD[kind]
}
