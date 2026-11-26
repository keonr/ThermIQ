import { useEffect, useState, type FormEvent } from 'react'
import type { Snapshot, Unit } from './telemetry.ts'
import type { Profile } from './equipment.ts'
import CookPlacements from './CookPlacements.tsx'
import CookInsights from './CookInsights.tsx'
import CookReplay from './CookReplay.tsx'
import CookReports from './CookReports.tsx'

const base = '/api/v1/sessions'

type Session = { capture_mode: string; id: string; name: string; started_at: string; ended_at: string | null; equipment: Profile | null }
type History = { snapshots: Snapshot[]; next_cursor: number | null; next_observed_at: string | null }

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', ...options })
  const body = await response.json()
  if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Session request failed.')
  return body
}

export default function CookSessions({ unit, profiles, probeIds, liveHistory, snapshot }: { unit: Unit; profiles: Profile[]; probeIds: string[]; liveHistory: Snapshot[]; snapshot?: Snapshot }) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [name, setName] = useState('')
  const [equipmentId, setEquipmentId] = useState('')
  const [selected, setSelected] = useState<string>()
  const [history, setHistory] = useState<History>()
  const [cursors, setCursors] = useState([0])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const active = sessions.find((session) => session.ended_at === null)
  const matchesCapture = (frame: Snapshot) => {
    if (!active || Date.parse(frame.observed_at) < Date.parse(active.started_at)) return false
    if (active.capture_mode === 'ble_direct') return frame.source === 'ble' && frame.device_id === 'direct-ble'
    if (active.capture_mode === 'ble') return frame.source === 'ble' && frame.device_id !== 'direct-ble'
    return frame.source === 'simulator' && (frame.device_id === 'simulated-relay') === (active.capture_mode === 'ble_simulator')
  }
  const activeSnapshot = snapshot && matchesCapture(snapshot) ? snapshot : undefined
  const activeHistory = liveHistory.filter(matchesCapture)
  const savedSession = sessions.find((session) => session.id === selected)

  useEffect(() => {
    const controller = new AbortController()
    request<Session[]>(base, { signal: controller.signal })
      .then(setSessions)
      .catch((failure) => { if (!controller.signal.aborted) setError(failure.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    request<History>(`${base}/${selected}/history?after=${cursors.at(-1)}`, { signal: controller.signal })
      .then(setHistory)
      .catch((failure) => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [selected, cursors])

  async function changeSession(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    setBusy(true)
    setError('')
    try {
      const session = await request<Session>(active ? `${base}/${active.id}/finish` : base, {
        method: 'POST',
        ...(active ? {} : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), equipment_id: equipmentId || null }),
        }),
      })
      setSessions((previous) => [session, ...previous.filter((item) => item.id !== session.id)])
      setName('')
      if (session.ended_at) showHistory(session.id)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Session request failed.')
    } finally {
      setBusy(false)
    }
  }

  function showHistory(id: string) {
    setError('')
    setHistory(undefined)
    setCursors([0])
    setSelected(id)
  }

  return (
    <section className="history" aria-labelledby="sessions-title">
      <h2 id="sessions-title">Cook sessions</h2>
      {error && <p role="alert">{error}</p>}
      {loading ? <p role="status">Loading sessions…</p> : active ? (
        <div className="session-controls">
          <p>Recording: {active.name} · {active.capture_mode === 'ble_direct' ? 'Direct Bluetooth' : active.capture_mode === 'ble' ? 'BLE relay' : 'Simulated'}{active.equipment && ` · ${active.equipment.name}`}</p>
          <button type="button" disabled={busy} onClick={() => void changeSession()}>Finish cook</button>
        </div>
      ) : (
        <form className="session-controls" onSubmit={changeSession}>
          <label>Cook name <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required /></label>
          <label>Equipment <select value={equipmentId} onChange={(event) => setEquipmentId(event.target.value)} disabled={busy}>
            <option value="">No layout</option>
            {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select></label>
          <button disabled={busy || !name.trim()}>Start cook</button>
        </form>
      )}
      {sessions.some((session) => session.ended_at) && (
        <ul className="session-list">
          {sessions.filter((session) => session.ended_at).map((session) => (
            <li key={session.id}>
              <button type="button" aria-pressed={selected === session.id} onClick={() => showHistory(session.id)}>
                {session.name} · {new Date(session.started_at).toLocaleString()}
              </button>
            </li>
          ))}
        </ul>
      )}
      {active && <CookInsights key={`insights-${active.id}`} history={activeHistory} snapshot={activeSnapshot} unit={unit} />}
      {active?.equipment && <CookPlacements key={`placements-${active.id}`} sessionId={active.id}
        initial={active.equipment} probeIds={probeIds} history={activeHistory} snapshot={activeSnapshot} unit={unit} />}
      {selected && !history && !error && <p role="status">Loading saved readings…</p>}
      {history && savedSession?.ended_at && (
        <>
          <div className="session-controls">
            <a href={`${base}/${savedSession.id}/export?format=csv`}>Export CSV</a>
            <a href={`${base}/${savedSession.id}/export?format=json`}>Export JSON</a>
          </div>
          <CookReplay key={`${savedSession.id}/${cursors.at(-1)}`} sessionId={savedSession.id}
            layout={savedSession.equipment} snapshots={history.snapshots} unit={unit}
            start={Date.parse(cursors.length === 1 ? savedSession.started_at : history.snapshots[0].observed_at)}
            end={history.next_observed_at ? Date.parse(history.next_observed_at) - 1 : Date.parse(savedSession.ended_at)} />
          {(cursors.length > 1 || history.next_cursor !== null) && <div className="session-controls">
            <button disabled={cursors.length === 1} onClick={() => { setHistory(undefined); setCursors(cursors.slice(0, -1)) }}>
              Earlier readings
            </button>
            <button disabled={history.next_cursor === null} onClick={() => {
              if (history.next_cursor === null) return
              setHistory(undefined)
              setCursors([...cursors, history.next_cursor])
            }}>Later readings</button>
          </div>}
        </>
      )}
      <CookReports sessions={sessions} unit={unit} />
    </section>
  )
}
