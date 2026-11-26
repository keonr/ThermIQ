import type { Snapshot } from './telemetry.ts'

const HISTORY_WINDOW_MS = 10 * 60 * 1000
const MAX_SNAPSHOTS = 300

export function recordSnapshot(history: Snapshot[], snapshot: Snapshot): Snapshot[] {
  const timestamp = Date.parse(snapshot.observed_at)
  if (!Number.isFinite(timestamp)) return history

  const previous = history.at(-1)
  if (previous?.device_id !== snapshot.device_id || previous.source !== snapshot.source) {
    return [snapshot]
  }
  if (timestamp <= Date.parse(previous.observed_at)) return history

  return [...history, snapshot]
    .filter((entry) => Date.parse(entry.observed_at) >= timestamp - HISTORY_WINDOW_MS)
    .slice(-MAX_SNAPSHOTS)
}
