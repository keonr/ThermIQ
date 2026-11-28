import type { Snapshot } from './telemetry.ts'

export const HISTORY_WINDOWS = [
  { id: '5m', label: '5 minutes', ms: 5 * 60 * 1000 },
  { id: '10m', label: '10 minutes', ms: 10 * 60 * 1000 },
  { id: '20m', label: '20 minutes', ms: 20 * 60 * 1000 },
  { id: '30m', label: '30 minutes', ms: 30 * 60 * 1000 },
  { id: '45m', label: '45 minutes', ms: 45 * 60 * 1000 },
  { id: '1h', label: '1 hour', ms: 60 * 60 * 1000 },
  { id: '2h', label: '2 hours', ms: 2 * 60 * 60 * 1000 },
  { id: '3h', label: '3 hours', ms: 3 * 60 * 60 * 1000 },
  { id: '4h', label: '4 hours', ms: 4 * 60 * 60 * 1000 },
  { id: '5h', label: '5 hours', ms: 5 * 60 * 60 * 1000 },
  { id: '6h', label: '6 hours', ms: 6 * 60 * 60 * 1000 },
  { id: '12h', label: '12 hours', ms: 12 * 60 * 60 * 1000 },
  { id: '24h', label: '24 hours', ms: 24 * 60 * 60 * 1000 },
] as const

export type HistoryWindowId = (typeof HISTORY_WINDOWS)[number]['id']

export const MAX_HISTORY_MS = 24 * 60 * 60 * 1000
export const RECENT_FULL_MS = 30 * 60 * 1000
export const OLDER_BUCKET_MS = 30 * 1000

export function recordSnapshot(history: Snapshot[], snapshot: Snapshot): Snapshot[] {
  const timestamp = Date.parse(snapshot.observed_at)
  if (!Number.isFinite(timestamp)) return history

  const previous = history.at(-1)
  if (previous?.device_id !== snapshot.device_id || previous.source !== snapshot.source) {
    return [snapshot]
  }
  if (timestamp <= Date.parse(previous.observed_at)) return history

  const windowCutoff = timestamp - MAX_HISTORY_MS
  const fullCutoff = timestamp - RECENT_FULL_MS
  const retained: Snapshot[] = []
  let lastBucket = -1

  for (const entry of history) {
    const entryTs = Date.parse(entry.observed_at)
    if (entryTs < windowCutoff) continue
    if (entryTs >= fullCutoff) {
      retained.push(entry)
      continue
    }
    const bucket = Math.floor(entryTs / OLDER_BUCKET_MS)
    if (bucket > lastBucket) {
      retained.push(entry)
      lastBucket = bucket
    }
  }
  retained.push(snapshot)
  return retained
}

export function mergeHistoryWindow(
  serverSnapshots: Snapshot[],
  liveHistory: Snapshot[],
  windowMs: number,
  nowMs: number,
  maxPoints = 600,
): { snapshots: Snapshot[]; stride: number; recentCutoff: number } {
  const reference = liveHistory.at(-1) ?? serverSnapshots.at(-1)
  if (!reference) return { snapshots: [], stride: 1, recentCutoff: 0 }

  const anchorMs = Math.max(nowMs, Date.parse(reference.observed_at))
  const cutoff = anchorMs - windowMs
  const byTime = new Map<number, Snapshot>()

  for (const collection of [serverSnapshots, liveHistory]) {
    for (const entry of collection) {
      if (entry.device_id !== reference.device_id || entry.source !== reference.source) continue
      const ts = Date.parse(entry.observed_at)
      if (!Number.isFinite(ts) || ts < cutoff || ts > anchorMs + 5000) continue
      byTime.set(ts, entry)
    }
  }

  const ordered = [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, entry]) => entry)

  if (ordered.length <= maxPoints) {
    return { snapshots: ordered, stride: 1, recentCutoff: anchorMs - RECENT_FULL_MS }
  }
  const stride = Math.ceil(ordered.length / maxPoints)
  const sampled = ordered.filter((_, index) => index % stride === 0 || index === ordered.length - 1)
  return { snapshots: sampled, stride, recentCutoff: anchorMs - RECENT_FULL_MS }
}

export function formatHistorySpan(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainderMinutes = minutes % 60
  return remainderMinutes === 0 ? `${hours}h` : `${hours}h ${remainderMinutes}m`
}
