import { lazy, Suspense, useEffect, useId, useState } from 'react'
import ChamberView from './ChamberView.tsx'
import ChamberHeatMap from './ChamberHeatMap.tsx'
import type { PlacementEvent } from './CookPlacements.tsx'
import type { Profile } from './equipment.ts'
import { latestAt } from './replay.ts'
import { formatTemperature, type Snapshot, type Unit } from './telemetry.ts'

const TemperatureChart = lazy(() => import('./TemperatureChart.tsx'))
const speeds = [1, 5, 10, 30, 60]

export default function CookReplay({ sessionId, layout, snapshots, unit, start, end }: {
  sessionId: string; layout: Profile | null; snapshots: Snapshot[]; unit: Unit; start: number; end: number
}) {
  const titleId = useId()
  const [playhead, setPlayhead] = useState(start)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(5)
  const [events, setEvents] = useState<PlacementEvent[]>([])
  const [layoutStatus, setLayoutStatus] = useState<'loading' | 'ready' | 'error'>(layout ? 'loading' : 'ready')

  useEffect(() => {
    if (!layout) return
    const controller = new AbortController()
    fetch(`/api/v1/sessions/${sessionId}/placements`, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load placements')
        const result: PlacementEvent[] = await response.json()
        if (controller.signal.aborted) return
        setEvents(result)
        setLayoutStatus('ready')
      })
      .catch(() => { if (!controller.signal.aborted) setLayoutStatus('error') })
    return () => controller.abort()
  }, [layout, sessionId])

  useEffect(() => {
    if (!playing) return
    let previous = performance.now()
    const interval = window.setInterval(() => {
      const now = performance.now()
      const elapsed = now - previous
      previous = now
      setPlayhead((time) => Math.min(end, time + elapsed * speed))
    }, 150)
    return () => window.clearInterval(interval)
  }, [end, playing, speed])

  const running = playing && playhead < end
  useEffect(() => {
    if (playing && playhead >= end) setPlaying(false)
  }, [end, playhead, playing])

  const current = latestAt(snapshots, (snapshot) => Date.parse(snapshot.observed_at), playhead)
  const event = latestAt(events, (item) => Date.parse(item.recorded_at), playhead)
  const eventMarkers = events.flatMap((item) => {
    const time = Date.parse(item.recorded_at)
    return time >= start && time <= end ? [{ time, label: `Placement change ${item.revision}` }] : []
  })

  function seek(time: number) {
    setPlaying(false)
    setPlayhead(time)
  }

  return (
    <section aria-labelledby={titleId}>
      <h3 id={titleId}>Cook replay</h3>
      <div className="session-controls">
        <button type="button" disabled={end <= start} onClick={() => {
          if (running) setPlaying(false)
          else {
            if (playhead >= end) setPlayhead(start)
            setPlaying(true)
          }
        }}>{running ? 'Pause' : 'Play'}</button>
        <label>Speed <select value={speed} onChange={(change) => setSpeed(Number(change.target.value))}>
          {speeds.map((value) => <option key={value} value={value}>{value}×</option>)}
        </select></label>
        <time dateTime={new Date(playhead).toISOString()}>{new Date(playhead).toLocaleTimeString()}</time>
      </div>
      <label className="replay-scrubber">Replay position
        <input type="range" min={start} max={end} step="any" value={playhead}
          disabled={end <= start} aria-valuetext={new Date(playhead).toLocaleTimeString()}
          onChange={(change) => seek(Number(change.target.value))} />
      </label>
      {eventMarkers.length > 0 && <div className="session-controls">
        {eventMarkers.map((marker) => <button type="button" key={marker.label} onClick={() => seek(marker.time)}>
          {marker.label} · {new Date(marker.time).toLocaleTimeString()}
        </button>)}
      </div>}
      {layoutStatus === 'loading' && <p role="status">Loading chamber history…</p>}
      {layoutStatus === 'error' && <p role="alert">Could not load chamber history.</p>}
      {layout && layoutStatus === 'ready' && (
        <>
          <p>{layout.name} · {event ? `Placement change ${event.revision}` : 'Starting layout'}</p>
          <ChamberView layout={event?.layout ?? layout} />
          <ChamberHeatMap layout={event?.layout ?? layout} snapshot={current} playhead={playhead}
            layoutSince={event ? Date.parse(event.recorded_at) : -Infinity} unit={unit} />
        </>
      )}
      {current ? (
        <div>
          <p>Last captured sample · {new Date(current.observed_at).toLocaleTimeString()}</p>
          <ul>
            {current.probes.map((probe) => {
              const core = current.readings.find((reading) => reading.probe_id === probe.id
                && reading.sensor_type === 'food_core' && reading.quality === 'valid')
              const ambient = current.readings.find((reading) => reading.probe_id === probe.id
                && reading.sensor_type === 'ambient' && reading.quality === 'valid')
              return <li key={probe.id}>{probe.name} · Core {formatTemperature(core?.temperature_c, unit)} · Ambient {formatTemperature(ambient?.temperature_c, unit)}</li>
            })}
          </ul>
        </div>
      ) : <p>{snapshots.length ? 'No sample captured at this point yet.' : 'This cook finished before any readings were captured.'}</p>}
      {snapshots.length > 0 && <Suspense fallback={<p role="status">Loading chart…</p>}>
        <TemperatureChart history={snapshots} unit={unit} saved timeline={{ start, end, playhead, events: eventMarkers }} />
      </Suspense>}
    </section>
  )
}
