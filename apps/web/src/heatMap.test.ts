import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ambientPoints, convexHull, distinctSites, estimateAt } from './heatMap.ts'
import type { Layout } from './equipment.ts'
import type { Snapshot } from './telemetry.ts'

test('heat estimates preserve uniform fields and combine coincident points', () => {
  const sites = distinctSites([
    { x: 0, y: 0, celsius: 90 }, { x: 0, y: 0, celsius: 110 },
    { x: 10, y: 10, celsius: 100 }, { x: 20, y: 20, celsius: 100 },
  ])
  assert.equal(sites.length, 3)
  assert.equal(convexHull(sites).length, 2)
  assert.ok(Math.abs(estimateAt(sites, { x: 0, y: 0 }, 1).celsius - 100) < 1e-9)
  assert.equal(convexHull([...sites, { x: 10, y: 0 }]).length, 3)
})

test('ambient heat coverage excludes stale, future and pre-move readings', () => {
  const layout: Layout = {
    name: 'Smoker', shape: 'rectangular', width_mm: 500, depth_mm: 500, height_mm: 300,
    food: [], probes: [{ probe_id: 'probe-1', x_mm: 10, y_mm: 20, angle_deg: 0, insertion_mm: 5 }],
  }
  const time = Date.parse('2026-01-01T00:00:00Z')
  const snapshot: Snapshot = {
    source: 'simulator', device_id: 'sim', probes: [], observed_at: new Date(time).toISOString(),
    readings: [{ probe_id: 'probe-1', sensor_id: 'ambient-1', sensor_type: 'ambient',
      sensor_index: null, temperature_c: 110, quality: 'valid', measured_at: new Date(time).toISOString() }],
  }
  assert.equal(ambientPoints(layout, snapshot, time, time).length, 1)
  assert.equal(ambientPoints(layout, snapshot, time + 6001, time).length, 0)
  assert.equal(ambientPoints(layout, snapshot, time - 1, time - 100).length, 0)
  assert.equal(ambientPoints(layout, snapshot, time + 10, time + 1).length, 0)
})
