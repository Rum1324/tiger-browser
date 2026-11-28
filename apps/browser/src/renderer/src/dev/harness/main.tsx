import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Harness } from './Harness'
import { Overlay } from './Overlay'
import './styles.css'

/**
 * The developer harness: a dev-only entry (harness.html) that the engine loads instead of the product
 * UI when TIGER_UI=harness is set in an unpackaged run. The end-to-end suite drives it. Same two routes
 * as the product entry: the main UI view and the overlay view (#overlay).
 */
const isOverlay = location.hash === '#overlay'
document.documentElement.dataset.view = isOverlay ? 'overlay' : 'main'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(<StrictMode>{isOverlay ? <Overlay /> : <Harness />}</StrictMode>)
}
