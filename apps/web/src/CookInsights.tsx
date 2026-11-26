import { useEffect, useRef, useState } from 'react'
import { channel, prediction } from './cookAnalysis.ts'
import { formatTemperature, type Snapshot, type Unit } from './telemetry.ts'

const explanations = {
  reached: 'Target reached',
  unavailable: 'Core reading unavailable',
  insufficient: 'Insufficient recent data',
  stall: 'Flat or falling trend',
  unstable: 'Unstable heating trend',
}

export default function CookInsights({ history, snapshot, unit }: {
  history: Snapshot[]; snapshot?: Snapshot; unit: Unit
}) {
  const [target, setTarget] = useState('')
  const [minimum, setMinimum] = useState('')
  const [maximum, setMaximum] = useState('')
  const [acknowledged, setAcknowledged] = useState<string[]>([])
  const [notifications, setNotifications] = useState(false)
  const [notificationMessage, setNotificationMessage] = useState('')
  const notified = useRef(new Set<string>())
  const probes = (snapshot ?? history.at(-1))?.probes ?? []
  const lower = minimum === '' ? null : Number(minimum)
  const upper = maximum === '' ? null : Number(maximum)
  const invalidRange = lower !== null && upper !== null && lower >= upper
  const targetC = target === '' ? null : Number(target)
  const alerts = snapshot ? probes.flatMap((probe) => {
    const core = channel(snapshot, probe.id, 'food_core')
    const ambient = channel(snapshot, probe.id, 'ambient')
    const battery = snapshot.readings.find((reading) => reading.probe_id === probe.id
      && reading.sensor_type === 'battery' && reading.quality === 'valid')?.battery_percent
    const missing = core === null && ambient === null
    return [
      ...(missing ? [{ id: `${probe.id}/missing`, message: `${probe.name}: temperature monitoring unavailable` }] : []),
      ...(targetC !== null && core !== null && core >= targetC
        ? [{ id: `${probe.id}/target/${targetC}`, message: `${probe.name}: core target reached` }] : []),
      ...(targetC !== null && core !== null && core < targetC && targetC - core <= 3
        ? [{ id: `${probe.id}/approaching/${targetC}`, message: `${probe.name}: approaching core target` }] : []),
      ...(battery != null && battery <= 15
        ? [{ id: `${probe.id}/battery`, message: `${probe.name}: battery low (${Math.round(battery)}%)` }] : []),
      ...(!invalidRange && ambient !== null && lower !== null && ambient < lower
        ? [{ id: `${probe.id}/low/${lower}`, message: `${probe.name}: ambient below ${formatTemperature(lower, unit)}` }] : []),
      ...(!invalidRange && ambient !== null && upper !== null && ambient > upper
        ? [{ id: `${probe.id}/high/${upper}`, message: `${probe.name}: ambient above ${formatTemperature(upper, unit)}` }] : []),
    ]
  }) : [{ id: 'feed', message: 'Temperature feed unavailable. Monitoring is interrupted.' }]

  const notificationAlerts = JSON.stringify(alerts.filter((alert) => !acknowledged.includes(alert.id)))
  useEffect(() => {
    if (!notifications) return
    const current: { id: string; message: string }[] = JSON.parse(notificationAlerts)
    const previous = notified.current
    notified.current = new Set(current.map((alert) => alert.id))
    try {
      for (const alert of current) {
        if (!previous.has(alert.id)) new Notification('ThermIQ cook alert', { body: alert.message })
      }
    } catch {
      setNotifications(false)
      setNotificationMessage('Browser delivery is unavailable. In-app alerts are still active.')
    }
  }, [notificationAlerts, notifications])

  async function toggleNotifications() {
    if (notifications) {
      setNotifications(false)
      return
    }
    try {
      const permission = await Notification.requestPermission()
      setNotifications(permission === 'granted')
      setNotificationMessage(permission === 'granted' ? 'Browser alerts enabled for this cook tab.' : 'Browser alerts were not enabled.')
    } catch {
      setNotificationMessage('Browser notifications are unavailable.')
    }
  }

  const activeIds = JSON.stringify(alerts.map((alert) => alert.id))
  useEffect(() => {
    const ids: string[] = JSON.parse(activeIds)
    setAcknowledged((previous) => previous.filter((id) => ids.includes(id)))
  }, [activeIds])

  return (
    <section aria-label="Cook alerts and estimates">
      <h3>Alerts and time to target</h3>
      <fieldset className="equipment-fields">
        {([
          ['Core target', target, setTarget], ['Ambient low', minimum, setMinimum], ['Ambient high', maximum, setMaximum],
        ] as const).map(([label, value, setter]) => (
          <label key={label}>{label} (°C)
            <input type="number" step="0.1" min="-100" max="1000" value={value}
              onChange={(event) => setter(event.target.value)} />
          </label>
        ))}
      </fieldset>
      {typeof Notification !== 'undefined' && <div className="session-controls">
        <button type="button" aria-pressed={notifications} onClick={() => void toggleNotifications()}>
          {notifications ? 'Disable browser alerts' : 'Enable browser alerts'}
        </button>
        {notificationMessage && <span role="status">{notificationMessage}</span>}
      </div>}
      {invalidRange && <p role="alert">Ambient low must be below ambient high.</p>}
      {alerts.length > 0 && <ul>
        {alerts.map((alert) => <li key={alert.id}>{alert.message}{' '}
          {acknowledged.includes(alert.id) ? <span>· Acknowledged</span>
            : <button type="button" onClick={() => setAcknowledged((ids) => [...ids, alert.id])}>Acknowledge</button>}
        </li>)}
      </ul>}
      {targetC !== null && snapshot && <ul>
        {probes.map((probe) => {
          const result = prediction(history, probe.id, targetC)
          return <li key={probe.id}>{probe.name} · {result.state === 'estimated'
            ? `About ${Math.max(1, Math.round(result.minutes))} min to target` : explanations[result.state]}</li>
        })}
      </ul>}
      <p>Trend estimates are for cook planning. Verify doneness independently.</p>
    </section>
  )
}
