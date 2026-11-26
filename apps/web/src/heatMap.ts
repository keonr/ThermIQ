import type { Layout } from './equipment.ts'
import type { Snapshot } from './telemetry.ts'

export type SpatialPoint = { x: number; y: number }
export type TemperaturePoint = SpatialPoint & { celsius: number }

export function ambientPoints(layout: Layout, snapshot: Snapshot | undefined, playhead: number, layoutSince: number) {
  return layout.probes.flatMap((probe) => {
    const reading = snapshot?.readings.find((entry) => entry.probe_id === probe.probe_id
      && entry.sensor_type === 'ambient' && entry.quality === 'valid')
    if (reading?.temperature_c == null || !Number.isFinite(reading.temperature_c)) return []
    const measuredAt = Date.parse(reading.measured_at)
    if (!Number.isFinite(measuredAt) || measuredAt < layoutSince || measuredAt > playhead
      || playhead - measuredAt > 6000) return []
    return [{ id: probe.probe_id, x: probe.x_mm, y: probe.y_mm, celsius: reading.temperature_c }]
  })
}

export function distinctSites(points: readonly TemperaturePoint[]): TemperaturePoint[] {
  const groups = new Map<string, { site: TemperaturePoint; count: number }>()
  for (const { x, y, celsius } of points) {
    const key = `${x},${y}`
    const group = groups.get(key)
    if (group) {
      group.site.celsius = (group.site.celsius * group.count + celsius) / (group.count + 1)
      group.count += 1
    } else groups.set(key, { site: { x, y, celsius }, count: 1 })
  }
  return Array.from(groups.values(), ({ site }) => site)
}

export function convexHull(points: readonly SpatialPoint[]): SpatialPoint[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (sorted.length < 3) return sorted

  function half(sequence: SpatialPoint[]) {
    const result: SpatialPoint[] = []
    for (const p of sequence) {
      while (result.length >= 2) {
        const a = result[result.length - 2]
        const b = result[result.length - 1]
        if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) > 0) break
        result.pop()
      }
      result.push(p)
    }
    return result.slice(0, -1)
  }
  return [...half(sorted), ...half(sorted.reverse())]
}

export function estimateAt(sites: readonly TemperaturePoint[], point: SpatialPoint, smoothingMm: number) {
  let weighted = 0
  let total = 0
  let nearestSquared = Infinity
  for (const site of sites) {
    const squared = (site.x - point.x) ** 2 + (site.y - point.y) ** 2
    const weight = 1 / (squared + smoothingMm ** 2)
    nearestSquared = Math.min(nearestSquared, squared)
    weighted += weight * site.celsius
    total += weight
  }
  return { celsius: weighted / total, distanceMm: Math.sqrt(nearestSquared) }
}
