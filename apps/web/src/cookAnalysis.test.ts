import assert from 'node:assert/strict'
import { test } from 'node:test'
import { persistentImbalance, prediction } from './cookAnalysis.ts'
import type { Snapshot } from './telemetry.ts'

const at = (seconds: number) => new Date(seconds * 1000).toISOString()
function frame(seconds: number, core: number, difference = 10): Snapshot {
  return {
    source: 'simulator', device_id: 'demo', observed_at: at(seconds), probes: [],
    readings: [
      { probe_id: 'hot', sensor_id: 'core', sensor_type: 'food_core',
        sensor_index: null, temperature_c: core, measured_at: at(seconds), quality: 'valid' },
      ...['hot', 'cold'].map((id) => ({ probe_id: id, sensor_id: id, sensor_type: 'ambient' as const,
        sensor_index: null, temperature_c: id === 'hot' ? 100 + difference : 100,
        measured_at: at(seconds), quality: 'valid' as const })),
    ],
  }
}

test('estimates known heating rate and suppresses flat or gapped trends', () => {
  const history = Array.from({ length: 61 }, (_, i) => frame(i * 2, 20 + i / 30))
  const result = prediction(history, 'hot', 30)
  assert.equal(result.state, 'estimated')
  if (result.state === 'estimated') assert.ok(Math.abs(result.minutes - 8) < 1e-8)
  assert.equal(prediction(history.filter((_, i) => i < 15 || i > 25), 'hot', 30).state, 'insufficient')
  assert.equal(prediction(history.map((_, i) => frame(i * 2, 20)), 'hot', 30).state, 'stall')
})

test('requires sustained ambient imbalance without gaps or transient crossings', () => {
  const history = Array.from({ length: 151 }, (_, i) => frame(i * 2, 20))
  assert.equal(persistentImbalance(history, ['cold', 'hot'], 8)?.hot.id, 'hot')
  assert.equal(persistentImbalance(history.slice(1), ['cold', 'hot'], 8), undefined)
  assert.equal(persistentImbalance(history.map((item, i) => i === 100 ? frame(200, 20, 2) : item),
    ['cold', 'hot'], 8), undefined)
})
