type SensorType = 'food_core' | 'internal_shaft' | 'ambient' | 'battery' | 'device_diagnostic' | 'unknown'

export type Reading = {
  probe_id: string
  sensor_id: string
  sensor_type: SensorType
  sensor_index: number | null
  temperature_c: number | null
  battery_percent?: number | null
  measured_at: string
  quality: 'valid' | 'missing' | 'invalid' | 'stale' | 'unsupported'
}

export type Snapshot = {
  source: 'simulator' | 'ble'
  device_id: string
  observed_at: string
  probes: { id: string; name: string }[]
  readings: Reading[]
}

export type Unit = 'C' | 'F'

export function formatTemperature(celsius: number | null | undefined, unit: Unit): string {
  if (celsius == null || !Number.isFinite(celsius)) return 'Unavailable'
  const value = unit === 'F' ? celsius * 9 / 5 + 32 : celsius
  return `${value.toFixed(1)}°${unit}`
}

export function probeLabel(probeId: string, probeNames?: Record<string, string>): string {
  return probeNames?.[probeId] || probeId
}
