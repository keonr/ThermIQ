import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import { HeatMapPlot } from './ChamberHeatMap.tsx'
import type { Layout } from './equipment.ts'
import { formatTemperature, type Unit } from './telemetry.ts'

const ComparisonChart = lazy(() => import('./ComparisonChart.tsx'))

type Session = { id: string; name: string; started_at: string; ended_at: string | null; equipment: { name: string } | null }
type Statistics = { count: number; mean_c: number; min_c: number; max_c: number; stddev_c: number }
type Frame = { elapsed_s: number; food_core: Record<string, number>; ambient: Record<string, number> }
type Summary = { duration_s: number; sample_count: number; ambient: Statistics | null; final_core_c: Record<string, number>; frames: Frame[] }
type Report = { id: string; equipment_id: string; layout: Layout | null; equipment_name: string; setpoint_c: number; chamber_load: string;
  ended_at: string; simulated: boolean; placed_count: number;
  locations: (Statistics & { probe_id: string; x_mm: number; y_mm: number; deviation_c: number })[] }

async function load<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...options })
  const body = await response.json()
  if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Could not generate report.')
  return body
}

export default function CookReports({ sessions, unit }: { sessions: Session[]; unit: Unit }) {
  const finished = sessions.filter((session) => session.ended_at !== null)
  return (
    <>
      <CookComparison finished={finished} unit={unit} />
      <Calibration finished={finished.filter((session) => session.equipment)} unit={unit} />
    </>
  )
}

function CookComparison({ finished, unit }: { finished: Session[]; unit: Unit }) {
  const [search, setSearch] = useState('')
  const [left, setLeft] = useState('')
  const [right, setRight] = useState('')
  const [results, setResults] = useState<{ name: string; summary: Summary }[]>()
  const [channel, setChannel] = useState<'food_core' | 'ambient'>('ambient')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const visible = finished.filter((session) => [session.name, session.equipment?.name].some(
    (name) => name?.toLowerCase().includes(search.toLowerCase()),
  ))

  async function compare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setResults(undefined)
    setError('')
    setLoading(true)
    try {
      setResults(await Promise.all([left, right].map(async (id) => ({
        name: finished.find((session) => session.id === id)?.name ?? id,
        summary: await load<Summary>(`/api/v1/sessions/${id}/summary`),
      }))))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not compare cooks.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section aria-labelledby="compare-cooks">
      <h3 id="compare-cooks">Compare cooks</h3>
      {finished.length < 2 ? <p>Finish at least two cooks to compare them.</p> : (
        <form className="session-controls" onSubmit={compare}>
          <label>Find cooks <input value={search} onChange={(event) => {
            setSearch(event.target.value)
            setLeft('')
            setRight('')
            setResults(undefined)
          }} disabled={loading} /></label>
          {([['First cook', left, setLeft], ['Second cook', right, setRight]] as const).map(([label, value, setter]) => (
            <label key={label}>{label} <select value={value} onChange={(event) => {
              setter(event.target.value)
              setResults(undefined)
            }} disabled={loading}>
              <option value="">Choose</option>
              {visible.map((session) => <option key={session.id} value={session.id}>
                {session.name} · {new Date(session.started_at).toLocaleString()}
              </option>)}
            </select></label>
          ))}
          <button disabled={loading || !left || !right || left === right}>{loading ? 'Comparing…' : 'Compare'}</button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      {results && <>
        <table className="report-table">
          <thead><tr><th scope="col">Cook</th><th scope="col">Duration</th><th scope="col">Samples</th><th scope="col">Ambient average</th><th scope="col">Ambient variation</th></tr></thead>
          <tbody>{results.map(({ name, summary }, index) => (
            <tr key={index}><th scope="row">{name}</th><td>{(summary.duration_s / 60).toFixed(1)} min</td>
              <td>{summary.sample_count}</td><td>{formatTemperature(summary.ambient?.mean_c, unit)}</td>
              <td>{summary.ambient ? `${(summary.ambient.stddev_c * (unit === 'F' ? 1.8 : 1)).toFixed(1)}°${unit} SD` : 'Unavailable'}</td></tr>
          ))}</tbody>
        </table>
        <label>Comparison channel <select value={channel} onChange={(event) => setChannel(event.target.value as typeof channel)}>
          <option value="ambient">Ambient</option><option value="food_core">Food core</option>
        </select></label>
        <Suspense fallback={<p role="status">Loading comparison chart…</p>}>
          <ComparisonChart unit={unit} series={results.flatMap(({ name, summary }, index) => {
            const ids = new Set(summary.frames.flatMap((frame) => Object.keys(frame[channel])))
            return [...ids].map((id) => ({ name: `${index + 1}. ${name} · ${id}`,
              values: summary.frames.map((frame): [number, number | null] => [frame.elapsed_s / 60, frame[channel][id] ?? null]),
            }))
          })} />
        </Suspense>
      </>}
    </section>
  )
}

function Calibration({ finished, unit }: { finished: Session[]; unit: Unit }) {
  const [sessionId, setSessionId] = useState('')
  const [setpoint, setSetpoint] = useState('225')
  const [minutes, setMinutes] = useState('5')
  const [chamberLoad, setChamberLoad] = useState('empty')
  const [reports, setReports] = useState<Report[]>([])
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    load<Report[]>('/api/v1/calibrations', { signal: controller.signal })
      .then((stored) => setReports((current) => [...current, ...stored.filter((item) => !current.some((report) => report.id === item.id))]))
      .catch(() => { if (!controller.signal.aborted) setError('Could not load saved calibrations.') })
    return () => controller.abort()
  }, [])

  async function calibrate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      const report = await load<Report>('/api/v1/calibrations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId, setpoint_c: (Number(setpoint) - 32) * 5 / 9,
          minutes: Number(minutes), chamber_load: chamberLoad,
        }),
      })
      setReports((existing) => [report, ...existing])
      setSelected(report.id)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save calibration.')
    } finally {
      setLoading(false)
    }
  }

  const report = reports.find((item) => item.id === selected)
  const ordered = report ? [...report.locations].sort((a, b) => a.mean_c - b.mean_c) : []
  const prior = report && reports.find((item) => item.id !== report.id && item.ended_at < report.ended_at
    && item.equipment_id === report.equipment_id && item.chamber_load === report.chamber_load
    && item.setpoint_c === report.setpoint_c && item.simulated === report.simulated
    && item.layout?.shape === report.layout?.shape && item.layout?.width_mm === report.layout?.width_mm
    && item.layout?.depth_mm === report.layout?.depth_mm && item.layout?.height_mm === report.layout?.height_mm)
  const comparisons = prior ? ordered.flatMap((item) => {
    const previous = prior.locations.find((location) => location.probe_id === item.probe_id
      && location.x_mm === item.x_mm && location.y_mm === item.y_mm)
    return previous ? [{ id: item.probe_id, delta: item.mean_c - previous.mean_c }] : []
  }) : []
  const delta = (value: number) => `${value > 0 ? '+' : ''}${(value * (unit === 'F' ? 1.8 : 1)).toFixed(1)}°${unit}`
  const cold = ordered[0]
  const hot = ordered.at(-1)

  return (
    <section aria-labelledby="calibration-title">
      <h3 id="calibration-title">Smoker calibration</h3>
      <p>Place probes in known positions, warm the chamber to its setpoint, and record a cook. Finish after a stable sampling period, then analyze that final window.</p>
      {finished.length > 0 && <form onSubmit={calibrate}>
        <fieldset className="equipment-fields" disabled={loading}>
          <label>Finished cook <select value={sessionId} required onChange={(event) => setSessionId(event.target.value)}>
            <option value="">Choose</option>
            {finished.map((session) => <option key={session.id} value={session.id}>{session.name}</option>)}
          </select></label>
          <label>Setpoint (°F) <input required type="number" min="86" max="752" step="any" value={setpoint} onChange={(event) => setSetpoint(event.target.value)} /></label>
          <label>Final sampling window (min) <input required type="number" min="0.1" max="720" step="any" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label>
          <label>Chamber load <select value={chamberLoad} onChange={(event) => setChamberLoad(event.target.value)}>
            <option value="empty">Empty</option><option value="loaded">Loaded</option>
          </select></label>
          <button disabled={!sessionId || loading}>{loading ? 'Analyzing…' : 'Analyze and save'}</button>
        </fieldset>
      </form>}
      {error && <p role="alert">{error}</p>}
      {reports.length > 0 && <label>Saved calibration <select value={selected} onChange={(event) => setSelected(event.target.value)}>
        <option value="">Choose</option>
        {reports.map((item) => <option value={item.id} key={item.id}>
          {item.equipment_name} · {formatTemperature(item.setpoint_c, unit)} · {new Date(item.ended_at).toLocaleString()}
        </option>)}
      </select></label>}
      {report && <>
        <p>{report.equipment_name} · {report.chamber_load} · Setpoint {formatTemperature(report.setpoint_c, unit)}
          {' · '}{report.locations.length}/{report.placed_count} placed probes sampled{report.simulated && ' · Simulated'}</p>
        {cold && hot && cold.mean_c < hot.mean_c && <p>Coolest sampled position: {cold.probe_id}. Warmest: {hot.probe_id}.
          Consider those positions when choosing where to place food for slower or faster heating.</p>}
        {report.layout && <HeatMapPlot layout={report.layout} unit={unit} title="Calibration heat map"
          simulated={report.simulated} emptyMessage="No calibrated probe locations."
          points={report.locations.map((location) => ({
            id: location.probe_id, x: location.x_mm, y: location.y_mm, celsius: location.mean_c,
          }))} />}
        {prior && comparisons.length > 0 && <>
          <h4>Change from the previous matching calibration</h4>
          <p>{new Date(prior.ended_at).toLocaleString()} · Same chamber dimensions, setpoint, and load</p>
          <ul>{comparisons.map((item) => <li key={item.id}>{item.id} · {delta(item.delta)}</li>)}</ul>
        </>}
        <table className="report-table">
          <thead><tr><th scope="col">Probe</th><th scope="col">Position (mm)</th><th scope="col">Samples</th><th scope="col">Average</th><th scope="col">Range</th><th scope="col">Variation</th><th scope="col">Δ Setpoint</th></tr></thead>
          <tbody>{ordered.map((item) => <tr key={item.probe_id}>
            <th scope="row">{item.probe_id}</th><td>{item.x_mm}, {item.y_mm}</td><td>{item.count}</td>
            <td>{formatTemperature(item.mean_c, unit)}</td><td>{formatTemperature(item.min_c, unit)}–{formatTemperature(item.max_c, unit)}</td>
            <td>{(item.stddev_c * (unit === 'F' ? 1.8 : 1)).toFixed(1)}°{unit} SD</td>
            <td>{(item.deviation_c * (unit === 'F' ? 1.8 : 1)).toFixed(1)}°{unit}</td>
          </tr>)}</tbody>
        </table>
      </>}
    </section>
  )
}
