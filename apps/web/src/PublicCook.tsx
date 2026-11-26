import { useEffect, useState } from 'react'
import ChamberHeatMap from './ChamberHeatMap.tsx'
import ChamberView from './ChamberView.tsx'
import type { Layout } from './equipment.ts'
import type { Snapshot, Unit } from './telemetry.ts'

type ActiveCook = {
  name: string
  started_at: string
  capture_mode: string
  layout: Layout | null
  layout_since: string
}

export default function PublicCook({ snapshot, unit }: { snapshot?: Snapshot; unit: Unit }) {
  const [cook, setCook] = useState<ActiveCook | null>()
  const [error, setError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    let next: number
    async function refresh() {
      try {
        const response = await fetch('/api/v1/view/active-cook', {
          cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
        })
        if (!response.ok) throw new Error('Active cook unavailable')
        const current: ActiveCook | null = await response.json()
        if (!controller.signal.aborted) {
          setCook(current)
          setError(false)
        }
      } catch {
        if (!controller.signal.aborted) setError(true)
      } finally {
        if (!controller.signal.aborted) next = window.setTimeout(refresh, 2000)
      }
    }
    void refresh()
    return () => { controller.abort(); window.clearTimeout(next) }
  }, [])

  const captureMatches = cook && snapshot && (
    cook.capture_mode === 'ble_direct' ? snapshot.device_id === 'direct-ble'
      : cook.capture_mode === 'ble' ? snapshot.source === 'ble' && snapshot.device_id !== 'direct-ble'
        : snapshot.source === 'simulator' && (snapshot.device_id === 'simulated-relay') === (cook.capture_mode === 'ble_simulator')
  )

  return (
    <section className="history" aria-labelledby="public-cook-title">
      <h2 id="public-cook-title">Active cook</h2>
      {error ? <p role="status">Could not refresh the active cook. Retrying…</p>
        : cook === undefined ? <p role="status">Loading active cook…</p>
          : cook ? <p>{cook.name} · Started {new Date(cook.started_at).toLocaleString()}</p>
            : <p>No cook is active. Live readings are still available above.</p>}
      <div className="session-controls" aria-label="Owner controls">
        <button disabled type="button">{cook ? 'Finish cook' : 'Start cook'}</button>
        <button disabled type="button">Add or edit equipment</button>
        <button disabled type="button">Change probe placement</button>
      </div>
      {cook?.layout && !error && (
        <>
          <ChamberView layout={cook.layout} />
          <ChamberHeatMap layout={cook.layout} snapshot={captureMatches ? snapshot : undefined}
            playhead={Date.now()} layoutSince={Date.parse(cook.layout_since)} unit={unit} />
        </>
      )}
    </section>
  )
}
