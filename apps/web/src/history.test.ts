import assert from 'node:assert/strict'
import { test } from 'node:test'
import { recordSnapshot } from './history.ts'
import type { Snapshot } from './telemetry.ts'

function snapshot(seconds: number, device_id = 'simulated-cq60'): Snapshot {
  return {
    source: 'simulator', device_id, probes: [], readings: [],
    observed_at: new Date(seconds * 1000).toISOString(),
  }
}

test('ignores duplicate and out-of-order snapshots', () => {
  const history = [snapshot(10)]
  assert.equal(recordSnapshot(history, snapshot(10)), history)
  assert.equal(recordSnapshot(history, snapshot(9)), history)
})

test('bounds the window and keeps each feed separate', () => {
  assert.deepEqual(recordSnapshot([snapshot(0), snapshot(2)], snapshot(601)), [snapshot(2), snapshot(601)])
  assert.deepEqual(recordSnapshot([snapshot(0)], snapshot(2, 'another-device')), [snapshot(2, 'another-device')])
  const history = Array.from({ length: 300 }, (_, index) => snapshot(index))
  assert.equal(recordSnapshot(history, snapshot(300)).length, 300)
})
