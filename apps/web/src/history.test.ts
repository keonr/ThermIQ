import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HISTORY_WINDOWS, MAX_HISTORY_MS, recordSnapshot, sliceHistoryWindow } from './history.ts'
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

test('retains up to 24 hours, thins older history, and keeps each feed separate', () => {
  assert.deepEqual(recordSnapshot([snapshot(0)], snapshot(2, 'another-device')), [snapshot(2, 'another-device')])

  // Drops readings older than 24 hours while retaining readings inside 24 hours.
  assert.deepEqual(
    recordSnapshot([snapshot(0), snapshot(60)], snapshot(MAX_HISTORY_MS / 1000 + 1)),
    [snapshot(60), snapshot(MAX_HISTORY_MS / 1000 + 1)],
  )

  // Keeps full resolution for recent 30 minutes and 30s buckets beyond 30 minutes.
  let history: Snapshot[] = []
  for (let seconds = 0; seconds <= 40 * 60; seconds += 2) {
    history = recordSnapshot(history, snapshot(seconds))
  }
  const older = history.filter((entry) => Date.parse(entry.observed_at) < 10 * 60 * 1000)
  const recent = history.filter((entry) => Date.parse(entry.observed_at) >= 10 * 60 * 1000)
  assert.equal(older.length, 20)
  assert.equal(recent.length, 901)
})

test('exposes requested time windows and slices cleanly', () => {
  assert.deepEqual(
    HISTORY_WINDOWS.map((option) => option.id),
    ['5m', '10m', '20m', '30m', '45m', '1h', '2h', '3h', '4h', '5h', '6h', '12h', '24h'],
  )
  const history = Array.from({ length: 1200 }, (_, index) => snapshot(index * 2))
  const fiveMin = sliceHistoryWindow(history, 5 * 60 * 1000)
  assert.equal(Date.parse(fiveMin.snapshots[0].observed_at), (1199 * 2 - 300) * 1000)
  assert.equal(fiveMin.stride, 1)

  const oneHour = sliceHistoryWindow(history, 60 * 60 * 1000, 300)
  assert.ok(oneHour.snapshots.length <= 301)
  assert.equal(oneHour.snapshots.at(-1)?.observed_at, history.at(-1)?.observed_at)
})
