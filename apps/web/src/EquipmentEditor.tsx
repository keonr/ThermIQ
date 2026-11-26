import { useId, useState, type FormEvent, type PointerEvent } from 'react'
import { equipmentRequest, type Food, type Layout, type Probe, type Profile } from './equipment.ts'
import { probeLabel } from './telemetry.ts'
import ChamberPlan from './ChamberPlan.tsx'

type Selection = { kind: 'food' | 'probes'; index: number }

const blank: Layout = {
  name: '', shape: 'rectangular', width_mm: 600, depth_mm: 450, height_mm: 400,
  food: [], probes: [],
}

type EditorProps = { probeIds: string[]; probeNames?: Record<string, string> } & (
  | { profiles: Profile[]; onSaved: (profile: Profile) => void; cook?: undefined }
  | { cook: { layout: Layout; save: (layout: Layout) => Promise<Layout> }; profiles?: undefined; onSaved?: undefined }
)

export default function EquipmentEditor({ probeIds, probeNames, profiles, onSaved, cook }: EditorProps) {
  const titleId = useId()
  const [profileId, setProfileId] = useState('')
  const [draft, setDraft] = useState<Layout>(cook?.layout ?? blank)
  const [selection, setSelection] = useState<Selection>()
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const selected = selection && draft[selection.kind][selection.index]
  const availableProbes = probeIds.filter((id) => !draft.probes.some((probe) => probe.probe_id === id))

  function update(patch: Partial<Layout>) {
    setDirty(true)
    setMessage('')
    setDraft((previous) => ({ ...previous, ...patch }))
  }

  function load(id: string) {
    const profile = profiles?.find((item) => item.id === id)
    setProfileId(id)
    setDraft(profile ?? blank)
    setSelection(undefined)
    setDirty(false)
    setMessage('')
  }

  function updatePlacement(patch: Partial<Food & Probe>) {
    if (!selection) return
    if (selection.kind === 'food') {
      update({ food: draft.food.map((item, index) => index === selection.index ? { ...item, ...patch } : item) })
    } else {
      update({ probes: draft.probes.map((item, index) => index === selection.index ? { ...item, ...patch } : item) })
    }
  }

  function position(event: PointerEvent<HTMLDivElement>) {
    if (busy || !selected || !event.isPrimary || event.button !== 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    updatePlacement({
      x_mm: Math.round((event.clientX - rect.left) / rect.width * draft.width_mm),
      y_mm: Math.round((event.clientY - rect.top) / rect.height * draft.depth_mm),
    })
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    setFailed(false)
    try {
      if (cook) {
        setDraft(await cook.save(draft))
      } else {
        const profile = await equipmentRequest<Profile>(profileId ? `/${profileId}` : '', {
          method: profileId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draft),
        })
        onSaved(profile)
        setProfileId(profile.id)
        setDraft(profile)
      }
      setDirty(false)
      setMessage(cook ? 'Placement change recorded.' : 'Equipment layout saved.')
    } catch (error) {
      setFailed(true)
      setMessage(error instanceof Error ? error.message : 'Could not save equipment.')
    } finally {
      setBusy(false)
    }
  }

  const center = { x_mm: Math.round(draft.width_mm / 2), y_mm: Math.round(draft.depth_mm / 2), angle_deg: 0 }

  return (
    <section className="history" aria-labelledby={titleId}>
      <h2 id={titleId}>{cook ? 'Edit cook placements' : 'Equipment and chamber layout'}</h2>
      <form onSubmit={save}>
        {!cook && <fieldset className="equipment-fields" disabled={busy}>
          <label>Equipment profile <select value={profileId} onChange={(event) => {
            if (!dirty || window.confirm('Discard unsaved layout changes?')) load(event.target.value)
          }}>
            <option value="">New equipment</option>
            {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select></label>
          <label>Name <input value={draft.name} maxLength={100} required onChange={(event) => update({ name: event.target.value })} /></label>
          <label>Shape <select value={draft.shape} onChange={(event) => {
            const shape = event.target.value as Layout['shape']
            update(shape === 'cylindrical' ? { shape, depth_mm: draft.width_mm } : { shape })
          }}>
            <option value="rectangular">Rectangular</option>
            <option value="cylindrical">Cylindrical</option>
          </select></label>
          {(['width_mm', 'depth_mm', 'height_mm'] as const).map((key) => (
            <label key={key}>{key.split('_')[0]} (mm)
              <input type="number" min={1} max={10000} step="any" required value={draft[key]}
                disabled={key === 'depth_mm' && draft.shape === 'cylindrical'}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  update(key === 'width_mm' && draft.shape === 'cylindrical'
                    ? { width_mm: value, depth_mm: value } : { [key]: value })
                }} />
            </label>
          ))}
        </fieldset>}
        <p>Select a placement, then tap the chamber to move it. Fine-tune the position with the controls below.</p>
        <ChamberPlan layout={draft} selection={selection} onSelect={setSelection} onPosition={position} probeNames={probeNames} />
        <div className="session-controls">
          <button type="button" disabled={busy || draft.food.length >= 32} onClick={() => {
            setSelection({ kind: 'food', index: draft.food.length })
            update({ food: [...draft.food, { ...center, id: crypto.randomUUID(), name: 'Food',
              width_mm: Math.max(draft.width_mm / 4, 1), depth_mm: Math.max(draft.depth_mm / 4, 1) }] })
          }}>Add food</button>
          <label>Place probe <select value="" disabled={busy || !availableProbes.length || draft.probes.length >= 32} onChange={(event) => {
            if (!event.target.value) return
            setSelection({ kind: 'probes', index: draft.probes.length })
            update({ probes: [...draft.probes, { ...center, probe_id: event.target.value, insertion_mm: Math.max(draft.width_mm / 8, 1) }] })
          }}>
            <option value="">Select a live probe</option>
            {availableProbes.map((id) => <option key={id} value={id}>{probeLabel(id, probeNames)}</option>)}
          </select></label>
        </div>
        {selected && selection && (
          <fieldset className="equipment-fields" disabled={busy}>
            <legend>{'name' in selected ? 'Food placement' : probeLabel(selected.probe_id, probeNames)}</legend>
            {'name' in selected && <label>Food name <input value={selected.name} required maxLength={100}
              onChange={(event) => updatePlacement({ name: event.target.value })} /></label>}
            {([
              ['x_mm', 'X (mm)', 0], ['y_mm', 'Y (mm)', 0], ['angle_deg', 'Angle (°)', 0],
              ...('name' in selected ? [['width_mm', 'Food width (mm)', 1], ['depth_mm', 'Food depth (mm)', 1]] as const
                : [['insertion_mm', 'Insertion depth (mm)', 1]] as const),
            ] as const).map(([key, title, min]) => (
              <label key={key}>{title}
                <input type="number" required step="any" min={min} max={key === 'angle_deg' ? 359.999 : 10000}
                  value={key in selected ? (selected as unknown as Record<string, number>)[key] : 0}
                  onChange={(event) => updatePlacement({ [key]: Number(event.target.value) })} />
              </label>
            ))}
            <button type="button" onClick={() => {
              if (selection.kind === 'food') update({ food: draft.food.filter((_, index) => index !== selection.index) })
              else update({ probes: draft.probes.filter((_, index) => index !== selection.index) })
              setSelection(undefined)
            }}>Remove placement</button>
          </fieldset>
        )}
        <div className="session-controls">
          <button type="submit" disabled={busy || !dirty}>{cook ? 'Record placement change' : 'Save equipment layout'}</button>
          {message && <p role={failed ? 'alert' : 'status'}>{message}</p>}
        </div>
      </form>
    </section>
  )
}
