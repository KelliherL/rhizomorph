import { PATHOLOGY_LADDER, type Organism } from '../model/organism.js'
import { LADDER_HUE } from '../render/palette.js'
import { MiniGlyph } from './MiniGlyph.js'

/**
 * Ruling 5. Thin, always present, and the only thing on the page allowed to
 * say "look at me". Calm state carries its evidence (ruling 14) — never bare
 * reassurance — and every alarm names the lane, the reason and the age.
 */
export function AttentionStrip({
  organism,
  selected,
  onSelect,
}: {
  organism: Organism
  selected: string | null
  onSelect: (laneId: string) => void
}) {
  const { attention, evidence } = organism

  if (attention.length === 0) {
    return (
      <header className="strip attention attention-clear">
        <span className="attention-verdict">ALL CLEAR</span>
        <span className="attention-evidence mono">
          {evidence.lanes} lanes · {evidence.branches} branches · {evidence.files} files checked ·
          collisions 0
        </span>
      </header>
    )
  }

  const worst = attention[0]?.ladder ?? 'needs-you'

  return (
    <header className="strip attention" data-ladder={worst}>
      <span className="attention-verdict" style={{ color: LADDER_HUE[worst] }}>
        ● {attention.length} NEED ATTENTION
      </span>
      <div className="attention-items">
        {attention.map((item) => (
          <button
            key={`${item.laneId}:${item.pathology}`}
            type="button"
            className={`attention-item${selected === item.laneId ? ' is-selected' : ''}`}
            style={{ borderColor: LADDER_HUE[item.ladder] }}
            onClick={() => onSelect(item.laneId)}
          >
            <MiniGlyph
              pathologies={[item.pathology]}
              colour={LADDER_HUE[PATHOLOGY_LADDER[item.pathology]]}
              size={14}
            />
            <span className="mono attention-lane">{item.label}</span>
            <span className="attention-why">{item.why}</span>
            <span className="mono attention-since">{item.since}</span>
          </button>
        ))}
      </div>
    </header>
  )
}
