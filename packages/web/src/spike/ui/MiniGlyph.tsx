import { laneGlyph } from '../render/glyphs.js'
import type { Pathology } from '../model/organism.js'

/**
 * The same glyph the scene draws, at table size. This is the legend: a reader
 * learns the alphabet from the rows and then reads it in the field, so the
 * scene never has to carry a key (ruling 21's "<30s, no text legend").
 */
export function MiniGlyph({
  pathologies,
  retired = false,
  colour,
  size = 15,
}: {
  pathologies: readonly Pathology[]
  retired?: boolean
  colour: string
  size?: number
}) {
  const parts = laneGlyph(pathologies, retired)
  return (
    <svg className="mini-glyph" width={size} height={size} viewBox="-2 -2 4 4" aria-hidden="true">
      {parts.map((part, index) =>
        part.stroke === undefined ? (
          <path key={index} d={part.d} fill={colour} opacity={part.opacity ?? 1} />
        ) : (
          <path
            key={index}
            d={part.d}
            fill="none"
            stroke={colour}
            strokeWidth={part.stroke}
            strokeLinecap={part.cap ?? 'round'}
            opacity={part.opacity ?? 1}
          />
        ),
      )}
    </svg>
  )
}
