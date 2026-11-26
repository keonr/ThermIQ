import { useEffect, useState } from 'react'
import { persistentImbalance } from './cookAnalysis.ts'
import { formatTemperature, type Snapshot, type Unit } from './telemetry.ts'
import ChamberHeatMap from './ChamberHeatMap.tsx'
import ChamberView from './ChamberView.tsx'
import EquipmentEditor from './EquipmentEditor.tsx'
import type { Layout, Profile } from './equipment.ts'

export type PlacementEvent = { revision: number; recorded_at: string; layout: Profile }

export default function CookPlacements({ sessionId, initial, probeIds, history, snapshot, unit }: {
  sessionId: string; initial: Profile; probeIds: string[]; history: Snapshot[]; snapshot?: Snapshot; unit: Unit
}) {
  const [events, setEvents] = useState<PlacementEvent[]>()
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const endpoint = `/api/v1/sessions/${sessionId}/placements`
  const last = events?.at(-1)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const response = await fetch(endpoint, { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error('Could not load placement history.')
        setEvents(await response.json())
      } catch {
        if (!controller.signal.aborted) setError('Could not load placement history.')
      }
    }
    void load()
    return () => controller.abort()
  }, [endpoint])

  async function save(layout: Layout): Promise<Layout> {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: last?.revision ?? 0, food: layout.food, probes: layout.probes }),
    })
    const body = await response.json()
    if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Could not record placement change.')
    setEvents((previous) => [...(previous ?? []), body])
    return body.layout
  }

  if (error) return <p role="alert">{error}</p>
  if (!events) return <p role="status">Loading placements…</p>

  const layout = last?.layout ?? initial
  const layoutSince = last ? Date.parse(last.recorded_at) : -Infinity
  const sites = new Map(layout.probes.map((probe) => [`${probe.x_mm},${probe.y_mm}`, probe.probe_id]))
  const imbalance = snapshot && persistentImbalance(
    history.filter((frame) => Date.parse(frame.observed_at) >= layoutSince), [...sites.values()], 15 * 5 / 9,
  )
  const selected = events.find((event) => event.revision === revision)
  return (
    <>
      <EquipmentEditor probeIds={probeIds} cook={{ layout: last?.layout ?? initial, save }} />
      <ChamberHeatMap layout={layout} snapshot={snapshot} playhead={Date.now()} layoutSince={layoutSince} unit={unit} />
      {imbalance && <section aria-label="Heat imbalance recommendation">
        <h3>Consider repositioning food</h3>
        <p>{imbalance.hot.id} has been at least {unit === 'F' ? '15°F' : '8.3°C'} warmer than {imbalance.cold.id} for at least five minutes.
          Latest ambient readings: {formatTemperature(imbalance.hot.value, unit)} and {formatTemperature(imbalance.cold.value, unit)}.</p>
        <p>Check probe placement. If the probes represent different sides of the food, consider rotating it or moving it toward the cooler zone. Record the move above to start a new analysis window.</p>
      </section>}
      <section aria-label="Placement history">
        <h3>Placement history</h3>
        <p>{initial.name} · {initial.width_mm} × {initial.depth_mm} × {initial.height_mm} mm</p>
        <label>Layout at <select value={revision} onChange={(event) => setRevision(Number(event.target.value))}>
          <option value={0}>Cook start</option>
          {events.map((event) => (
            <option key={event.revision} value={event.revision}>
              Change {event.revision} · {new Date(event.recorded_at).toLocaleString()}
            </option>
          ))}
        </select></label>
        <ChamberView layout={selected?.layout ?? initial} />
      </section>
    </>
  )
}
