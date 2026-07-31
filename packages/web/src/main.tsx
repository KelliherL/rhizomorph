import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SigilPage } from './spike/SigilPage.js'

// SPIKE B (prd3 ruling 24). Disposable branch: the shell and its panel grid
// are still in the tree and still tested, but the page this build serves is
// the sigil organism, so the direction can be judged in a browser.

const container = document.getElementById('root')
if (!container) {
  throw new Error('missing #root element')
}

createRoot(container).render(
  <StrictMode>
    <SigilPage />
  </StrictMode>,
)
