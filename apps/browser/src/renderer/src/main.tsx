import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Harness } from './Harness'
import { Overlay } from './Overlay'

// One bundle, two entry routes: the main UI view and the overlay view (loaded with #overlay).
const isOverlay = location.hash === '#overlay'
document.documentElement.dataset.view = isOverlay ? 'overlay' : 'main'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(<StrictMode>{isOverlay ? <Overlay /> : <Harness />}</StrictMode>)
}
