import type { Snapshot } from './telemetry.ts'

export function channel(snapshot: Snapshot | undefined, probe: string, type: 'food_core' | 'ambient') {
  return snapshot?.readings.find((reading) => reading.probe_id === probe
    && reading.sensor_type === type && reading.quality === 'valid')?.temperature_c ?? null
}

export function prediction(history: Snapshot[], probe: string, target: number) {
  const end = Date.parse(history.at(-1)?.observed_at ?? '')
  const current = channel(history.at(-1), probe, 'food_core')
  if (current === null) return { state: 'unavailable' } as const
  if (current >= target) return { state: 'reached' } as const

  const samples = history.flatMap((snapshot) => {
    const at = Date.parse(snapshot.observed_at)
    const value = channel(snapshot, probe, 'food_core')
    return value !== null && end - at <= 180000 ? [{ at, value }] : []
  })
  const window = samples.filter((sample, index) => index % 5 === 0 || index === samples.length - 1)
  if (window.length < 4 || end - window[0].at < 60000
    || samples.some((sample, index) => index > 0 && sample.at - samples[index - 1].at > 10000)) {
    return { state: 'insufficient' } as const
  }

  const rates = window.flatMap((sample, index) => window.slice(index + 1)
    .filter((later) => later.at - sample.at >= 10000)
    .map((later) => (later.value - sample.value) / ((later.at - sample.at) / 60000)))
    .sort((a, b) => a - b)
  const slope = rates[Math.floor(rates.length / 2)]
  if (!Number.isFinite(slope)) return { state: 'insufficient' } as const
  if (slope <= 0.05) return { state: 'stall' } as const
  if (rates[Math.floor(rates.length / 4)] <= 0) return { state: 'unstable' } as const
  const minutes = (target - current) / slope
  return minutes <= 720 ? { state: 'estimated', minutes, slope } as const : { state: 'insufficient' } as const
}

export function persistentImbalance(history: Snapshot[], ids: string[], threshold: number, durationMs = 300000) {
  const latest = history.at(-1)
  if (!latest || ids.length < 2) return undefined
  const values = ids.flatMap((id) => {
    const value = channel(latest, id, 'ambient')
    return value === null ? [] : [{ id, value }]
  }).sort((a, b) => a.value - b.value)
  const cold = values[0]
  const hot = values.at(-1)
  if (!cold || !hot || hot.value - cold.value < threshold) return undefined

  const end = Date.parse(latest.observed_at)
  let next = end
  for (let index = history.length - 1; index >= 0; index--) {
    const frame = history[index]
    const time = Date.parse(frame.observed_at)
    const high = channel(frame, hot.id, 'ambient')
    const low = channel(frame, cold.id, 'ambient')
    if (next - time > 6000 || high === null || low === null || high - low < threshold) break
    if (end - time >= durationMs) return { hot, cold }
    next = time
  }
  return undefined
}
