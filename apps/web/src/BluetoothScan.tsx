import { useEffect, useState } from 'react'

type ScanStatus = { scanning: boolean; probe_count: number }
const endpoint = '/api/v1/bluetooth/scan'

export default function BluetoothScan() {
  const [status, setStatus] = useState<ScanStatus>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function changeScan(method: 'POST' | 'DELETE') {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(endpoint, { method, headers: { "X-ThermIQ-Local": "1" }, signal: AbortSignal.timeout(30000) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.detail ?? 'Bluetooth request failed.')
      setStatus(body)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Bluetooth request failed.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    const refresh = async () => {
      try {
        const response = await fetch(endpoint, { cache: 'no-store', signal: controller.signal })
        if (response.ok) {
          const next: ScanStatus = await response.json()
          if (!controller.signal.aborted) setStatus(next)
        }
      } catch {
        // The telemetry panel handles API outages.
      }
    }
    void refresh()
    const interval = window.setInterval(refresh, 2000)
    return () => { controller.abort(); window.clearInterval(interval) }
  }, [])

  return (
    <section aria-label="Direct Bluetooth">
      <div className="session-controls">
        <button type="button" disabled={busy || !status}
          onClick={() => void changeScan(status?.scanning ? 'DELETE' : 'POST')}>
          {status?.scanning ? 'Stop Bluetooth scan' : 'Start Bluetooth scan'}
        </button>
        <span role="status">{status?.scanning
          ? `Scanning · ${status.probe_count} probe${status.probe_count === 1 ? '' : 's'} found`
          : 'Bluetooth scan is off'}</span>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
