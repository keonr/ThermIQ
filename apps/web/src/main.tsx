import { lazy, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { formatTemperature, type Reading, type Snapshot, type Unit } from './telemetry.ts'
import { recordSnapshot } from './history.ts'
import BluetoothScan from './BluetoothScan.tsx'
import ProbeSettings from './ProbeSettings.tsx'
import PublicCook from './PublicCook.tsx'
import CookSessions from './CookSessions.tsx'
import EquipmentEditor from './EquipmentEditor.tsx'
import { equipmentRequest, type Profile } from './equipment.ts'
import './styles.css'

const TemperatureChart = lazy(() => import('./TemperatureChart.tsx'))

type DashboardState =
  | { status: 'loading' }
  | { status: 'ready'; snapshot: Snapshot }
  | { status: 'error'; message: string }

function temperature(reading: Reading | undefined, unit: Unit) {
  return formatTemperature(reading?.quality === 'valid' ? reading.temperature_c : null, unit)
}

function App() {
  const [state, setState] = useState<DashboardState>({ status: 'loading' })
  const [access, setAccess] = useState<"loading" | "owner" | "viewer" | "error">("loading")
  const [directBluetooth, setDirectBluetooth] = useState(false)
  const [unit, setUnit] = useState<Unit>('F')
  const [history, setHistory] = useState<Snapshot[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [profileError, setProfileError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/access', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Access check failed')
        const result = await response.json()
        if (typeof result.read_only !== 'boolean') throw new Error('Invalid access response')
        if (!controller.signal.aborted) setAccess(result.read_only ? 'viewer' : 'owner')
      })
      .catch(() => { if (!controller.signal.aborted) setAccess('error') })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (access !== 'owner') return
    const controller = new AbortController()
    fetch('/api/health', { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((health) => { if (health?.telemetry_source === 'ble_direct') setDirectBluetooth(true) })
      .catch(() => {})
    equipmentRequest<Profile[]>('', { signal: controller.signal })
      .then((loaded) => setProfiles((current) => [
        ...current, ...loaded.filter((profile) => !current.some((item) => item.id === profile.id)),
      ]))
      .catch(() => {
        if (!controller.signal.aborted) setProfileError('Could not load saved equipment profiles.')
      })
    return () => controller.abort()
  }, [access])

  useEffect(() => {
    let stopped = false
    let nextPoll: number
    let request: AbortController

    async function poll() {
      request = new AbortController()
      try {
        const response = await fetch('/api/v1/telemetry', {
          cache: 'no-store',
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
        })
        if (!response.ok) {
          const body = await response.json().catch(() => undefined)
          throw new Error(typeof body?.detail === 'string' ? body.detail : 'Temperature feed unavailable.')
        }
        const snapshot: Snapshot = await response.json()
        if (!stopped) {
          setState({ status: 'ready', snapshot })
          setHistory((previous) => recordSnapshot(previous, snapshot))
        }
      } catch (error) {
        if (!stopped) setState({
          status: 'error',
          message: error instanceof Error && error.name === 'Error'
            ? error.message
            : 'Could not reach the temperature feed.',
        })
      } finally {
        if (!stopped) nextPoll = window.setTimeout(poll, 2000)
      }
    }

    void poll()
    return () => {
      stopped = true
      window.clearTimeout(nextPoll)
      request?.abort()
    }
  }, [])

  const snapshot = state.status === 'ready' ? state.snapshot : undefined
  const probeNames = snapshot ? Object.fromEntries(snapshot.probes.map((probe) => [probe.id, probe.name])) : undefined
  const source = snapshot?.source === 'simulator' ? 'Simulator'
    : snapshot?.device_id === 'direct-ble' ? 'Direct Bluetooth' : 'Bluetooth relay'

  return (
    <main>
      <header className="topbar">
        <strong>Therm<span>IQ</span></strong>
        <fieldset>
          <legend className="sr-only">Temperature unit</legend>
          {(['F', 'C'] as const).map((option) => (
            <button key={option} aria-pressed={unit === option} onClick={() => setUnit(option)}>
              °{option}
            </button>
          ))}
        </fieldset>
      </header>
      {access === 'viewer' && <p className="readonly-banner" role="status">
        <span aria-hidden="true">🔒 </span><strong>Read only</strong> · You can view live readings and the active cook.
      </p>}
      {access === 'error' && <p role="alert">Could not verify dashboard access. Editing controls are unavailable.</p>}
      {access === 'owner' && directBluetooth && <BluetoothScan />}
      <section aria-labelledby="dashboard-title">
        <div className="overview">
          <div>
            <h1 id="dashboard-title">Probe dashboard</h1>
            {snapshot && <p>{snapshot.source === 'simulator' ? 'Synthetic readings' : snapshot.device_id}</p>}
          </div>
          {snapshot && <span className="source">{source}</span>}
        </div>

        {state.status === 'loading' && <p role="status">Loading temperature feed…</p>}
        {state.status === 'error' && <p className="error" role="status">{state.message} Retrying automatically.</p>}
        {snapshot && (
          <>
            <div className="probes">
              {snapshot.probes.map((probe) => {
                const readings = snapshot.readings.filter((reading) => reading.probe_id === probe.id)
                const core = readings.find((reading) => reading.sensor_type === 'food_core')
                const ambient = readings.find((reading) => reading.sensor_type === 'ambient')
                const shaft = readings.filter((reading) => reading.sensor_type === 'internal_shaft')
                return (
                  <article key={probe.id}>
                    <h2>{probe.name}</h2>
                    <dl>
                      <div className="core"><dt>Food core</dt><dd>{temperature(core, unit)}</dd></div>
                      <div><dt>Ambient</dt><dd>{temperature(ambient, unit)}</dd></div>
                      {shaft.map((reading) => (
                        <div key={reading.sensor_id}>
                          <dt>Shaft {reading.sensor_index == null ? '' : reading.sensor_index + 1}</dt>
                          <dd>{temperature(reading, unit)}</dd>
                        </div>
                      ))}
                    </dl>
                  </article>
                )
              })}
            </div>
            {snapshot.probes.length === 0 && <p>No probes discovered.</p>}
            <p className="timestamp">
              Last sample <time dateTime={snapshot.observed_at}>{new Date(snapshot.observed_at).toLocaleTimeString()}</time>
            </p>
            {access === 'owner' && snapshot.probes.length > 0 && (
              <ProbeSettings probes={snapshot.probes} onSaved={(probes) => setState((current) =>
                current.status === 'ready' ? { ...current, snapshot: { ...current.snapshot, probes } } : current)} />
            )}
          </>
        )}
      </section>
      {history.length > 0 && (
        <Suspense fallback={<p role="status">Loading chart…</p>}>
          <TemperatureChart history={history} unit={unit} />
        </Suspense>
      )}
      {access === 'viewer' && <PublicCook snapshot={snapshot} unit={unit} />}
      {access === 'owner' && <>
        <CookSessions unit={unit} profiles={profiles} liveHistory={history} snapshot={snapshot}
          probeIds={snapshot?.probes.map((probe) => probe.id) ?? []} probeNames={probeNames} />
        {profileError && <p role="alert">{profileError}</p>}
        <EquipmentEditor probeIds={snapshot?.probes.map((probe) => probe.id) ?? []} probeNames={probeNames} profiles={profiles}
          onSaved={(profile) => setProfiles((current) => [profile, ...current.filter((item) => item.id !== profile.id)])} />
      </>}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
