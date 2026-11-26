import { Component, lazy, Suspense, useState, type ReactNode } from 'react'
import ChamberPlan from './ChamberPlan.tsx'
import type { Layout } from './equipment.ts'

const Chamber3D = lazy(() => import('./Chamber3D.tsx'))

class RenderingFallback extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? <p role="status">3D rendering is unavailable. Select 2D to inspect this layout.</p> : this.props.children
  }
}

export default function ChamberView({ layout }: { layout: Layout }) {
  const [spatialView, setSpatialView] = useState(false)

  return (
    <section aria-label="Chamber view">
      <div className="session-controls">
        <button type="button" aria-pressed={!spatialView} onClick={() => setSpatialView(false)}>2D</button>
        <button type="button" aria-pressed={spatialView} onClick={() => setSpatialView(true)}>3D</button>
      </div>
      {spatialView ? (
        <>
          <p>Drag to orbit and scroll or pinch to zoom. Food and probes are shown on the layout plane.</p>
          <RenderingFallback>
            <Suspense fallback={<p role="status">Loading 3D view…</p>}>
              <Chamber3D layout={layout} />
            </Suspense>
          </RenderingFallback>
        </>
      ) : <ChamberPlan layout={layout} />}
    </section>
  )
}
