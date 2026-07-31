import type { Ladder } from '../model/organism.js'

/**
 * Ruling 9, as code. Four hues, one per rung of the alarm ladder, and nothing
 * else on the page is allowed to want one. Identity — which lane, which role,
 * which generation — is carried by weight, position, glyph and lightness.
 */
export const LADDER_HUE: Record<Ladder, string> = {
  // Calm is neutral by law, so its neon has to come from luminance rather than
  // hue: a cold near-white that glows against the void without owning a colour.
  calm: '#b3c6de',
  notice: '#4deaff',
  'needs-you': '#ffc857',
  broken: '#ff3d7f',
}

/** Dead tissue. FROZEN's limb greys out; only its node keeps the broken hue. */
export const NECROTIC = '#5c6474'

export const VOID = '#05060a'
