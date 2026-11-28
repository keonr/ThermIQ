import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  HISTORY_WINDOWS, MAX_HISTORY_MS, formatHistorySpan, mergeHistoryWindow, recordSnapshot,
} from './history.ts'
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

  assert.deepEqual(
    recordSnapshot([snapshot(0), snapshot(60)], snapshot(MAX_HISTORY_MS / 1000 + 1)),
    [snapshot(60), snapshot(MAX_HISTORY_MS / 1000 + 1)],
  )

  let history: Snapshot[] = []
  for (let seconds = 0; seconds <= 40 * 60; seconds += 2) {
    history = recordSnapshot(history, snapshot(seconds))
  }
  const older = history.filter((entry) => Date.parse(entry.observed_at) < 10 * 60 * 1000)
  const recent = history.filter((entry) => Date.parse(entry.observed_at) >= 10 * 60 * 1000)
  assert.equal(older.length, 20)
  assert.equal(recent.length, 901)
})

test('exposes requested time windows, ignores out-of-window samples, and formats spans', () => {
  assert.deepEqual(
    HISTORY_WINDOWS.map((option) => option.id),
    ['5m', '10m', '20m', '30m', '45m', '1h', '2h', '3h', '4h', '5h', '6h', '12h', '24h'],
  )

  // A 10-minute-old reading is ignored when a 5-minute window is selected relative to now.
  const server = [snapshot(100), snapshot(700)]
  const live = [snapshot(710)]
  const fiveMin = mergeHistoryWindow(server, live, 5 * 60 * 1000, 1200 * 1000)
  assert.deepEqual(fiveMin.snapshots, [])

  const oneHour = mergeHistoryWindow(server, live, 60 * 60 * 1000, 720 * 1000)
  assert.deepEqual(oneHour.snapshots.map((item) => item.observed_at), [
    snapshot(100).observed_at, snapshot(700).observed_at, snapshot(710).observed_at,
  ])

  const dense = Array.from({ length: 1200 }, (_, index) => snapshot(index * 2))
  const capped = mergeHistoryWindow(dense, [], 60 * 60 * 1000, 2398 * 1000, 300)
  assert.ok(capped.snapshots.length <= 301)
  assert.equal(capped.snapshots.at(-1)?.observed_at, dense.at(-1)?.observed_at)

  assert.equal(formatHistorySpan(5000), '5s')
  assert.equal(formatHistorySpan(12 * 60 * 1000), '12m')
  assert.equal(formatHistorySpan(75 * 60 * 1000), '1h 15m')
  assert.equal(formatHistorySpan(2 * 60 * 60 * 1000), '2h')
})
