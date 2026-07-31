import { useEffect, useRef, useState } from 'react'
import type { Fleet } from '../data/fleet.js'
import { layoutScene, type SceneGeometry } from './geometry.js'
import type { PulseField } from './pulses.js'
import { render } from './render.js'

export interface MyceliumProps {
  fleet: Fleet
  field: PulseField
  /** The lane the spotlight is on — chosen by the attention strip, not here. */
  focusId: string | null
  onSelect: (laneId: string | null) => void
  hoverId: string | null
  onHover: (laneId: string | null) => void
}

/**
 * The canvas. Everything visual is in `render.ts`; this component owns the
 * frame loop, the device-pixel scaling and hit testing, and nothing else.
 *
 * The loop runs even when nothing is happening, because recency drift and the
 * root-mass's breathing are continuous — but with no events in flight there is
 * nothing moving on it, which is the point.
 */
export function Mycelium({ fleet, field, focusId, onSelect, hoverId, onHover }: MyceliumProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const geometryRef = useRef<SceneGeometry | null>(null)
  const [reducedMotion, setReducedMotion] = useState(false)

  // Props change often; the frame loop must not be torn down and rebuilt for it.
  const latest = useRef({ fleet, field, focusId, hoverId, reducedMotion })
  latest.current = { fleet, field, focusId, hoverId, reducedMotion }

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(query.matches)
    const onChange = () => setReducedMotion(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const host = hostRef.current
    if (canvas === null || host === null) return

    let frame = 0
    let width = 0
    let height = 0

    const resize = () => {
      const rect = host.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      width = Math.max(320, Math.floor(rect.width))
      height = Math.max(240, Math.floor(rect.height))
      // Backing store only. The element's *size* is CSS (absolute, inset 0), so
      // it can never feed back into the grid track that contains it — a canvas
      // with a pixel width in an `1fr` column will happily push the column wider
      // than the viewport, one resize at a time.
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      const ctx = canvas.getContext('2d')
      if (ctx !== null) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    const tick = () => {
      frame = requestAnimationFrame(tick)
      const ctx = canvas.getContext('2d')
      if (ctx === null) return
      const now = Date.now()
      const current = latest.current
      current.field.step(now)
      const geometry = layoutScene(current.fleet, width, height, now)
      geometryRef.current = geometry
      render({
        ctx,
        geometry,
        fleet: current.fleet,
        field: current.field,
        now,
        reducedMotion: current.reducedMotion,
        focusId: current.focusId,
        hoverId: current.hoverId,
      })
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  const laneAt = (clientX: number, clientY: number): string | null => {
    const geometry = geometryRef.current
    const canvas = canvasRef.current
    if (geometry === null || canvas === null) return null
    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top

    let best: string | null = null
    let bestDistance = 30
    for (const thread of geometry.threads) {
      const distance = Math.hypot(thread.node.x - x, thread.node.y - y)
      if (distance < bestDistance) {
        bestDistance = distance
        best = thread.laneId
      }
    }
    return best
  }

  return (
    <div ref={hostRef} className="scene-host">
      <canvas
        ref={canvasRef}
        className="scene-canvas"
        onMouseMove={(event) => onHover(laneAt(event.clientX, event.clientY))}
        onMouseLeave={() => onHover(null)}
        onClick={(event) => {
          const lane = laneAt(event.clientX, event.clientY)
          onSelect(lane === focusId ? null : lane)
        }}
      />
    </div>
  )
}
