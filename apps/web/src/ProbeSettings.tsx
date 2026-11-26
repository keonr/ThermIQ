import { useState, type FormEvent } from 'react'
import type { Snapshot } from './telemetry.ts'

type ProbeItem = Snapshot['probes'][number]

export default function ProbeSettings({ probes, onSaved }: {
  probes: ProbeItem[]
  onSaved: (updated: ProbeItem[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<ProbeItem[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)

  function openEditor() {
    setDraft(probes.map((probe) => ({ ...probe })))
    setMessage('')
    setFailed(false)
    setOpen(true)
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta
    if (target < 0 || target >= draft.length) return
    setDraft((current) => {
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return next
    })
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    setFailed(false)
    try {
      const response = await fetch('/api/v1/probes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft.map((probe, sort_order) => ({
          probe_id: probe.id, name: probe.name.trim(), sort_order,
        }))),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Could not save probe names.')
      const updated: ProbeItem[] = body.map((item: { probe_id: string; name: string }) => ({
        id: item.probe_id, name: item.name,
      }))
      onSaved(updated)
      setMessage('Probe names and order saved.')
      setOpen(false)
    } catch (error) {
      setFailed(true)
      setMessage(error instanceof Error ? error.message : 'Could not save probe names.')
    } finally {
      setBusy(false)
    }
  }

  const displayed = open ? [
    ...draft,
    ...probes.filter((probe) => !draft.some((item) => item.id === probe.id)),
  ] : []

  return (
    <div className="probe-settings">
      <div className="session-controls">
        {!open && <button type="button" onClick={openEditor}>Rename &amp; reorder probes</button>}
        {message && !open && <p role="status">{message}</p>}
      </div>
      {open && (
        <form className="history" onSubmit={save}>
          <h2>Probe names &amp; order</h2>
          <p>Display names and card order are saved locally on this server; hardware IDs stay unchanged.</p>
          <ul className="probe-order-list">
            {displayed.map((probe, index) => (
              <li className="probe-order-row" key={probe.id}>
                <label>
                  <span className="probe-id">{probe.id}</span>
                  <input value={probe.name} maxLength={100} required disabled={busy}
                    onChange={(event) => {
                      const name = event.target.value
                      setDraft((current) => current.some((item) => item.id === probe.id)
                        ? current.map((item) => item.id === probe.id ? { ...item, name } : item)
                        : [...current, { ...probe, name }])
                    }} />
                </label>
                <div className="session-controls">
                  <button type="button" aria-label={`Move ${probe.name || probe.id} up`}
                    disabled={busy || index === 0} onClick={() => move(index, -1)}>↑</button>
                  <button type="button" aria-label={`Move ${probe.name || probe.id} down`}
                    disabled={busy || index === displayed.length - 1} onClick={() => move(index, 1)}>↓</button>
                </div>
              </li>
            ))}
          </ul>
          <div className="session-controls">
            <button disabled={busy}>{busy ? 'Saving…' : 'Save probe names'}</button>
            <button type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
          </div>
          {message && <p className={failed ? 'error' : undefined} role={failed ? 'alert' : 'status'}>{message}</p>}
        </form>
      )}
    </div>
  )
}
