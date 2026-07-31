import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SpikeApp } from './spike/SpikeApp.js'
import './index.css'

/**
 * prd3 spike round, DIRECTION C. This entry point renders the spike page; the
 * shipped shell (`App.tsx` and everything under `app/`, `panels/`, `scene/`) is
 * left untouched on this disposable branch so the two can be diffed.
 */
const container = document.getElementById('root')
if (!container) {
  throw new Error('missing #root element')
}

createRoot(container).render(
  <StrictMode>
    <SpikeApp />
  </StrictMode>,
)
