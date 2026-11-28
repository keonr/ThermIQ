import { useEffect, useId, useRef, useState } from 'react'
import { LineChart, type LineSeriesOption } from 'echarts/charts'
import {
  AriaComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent,
} from 'echarts/components'
import { init, use, type EChartsType } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import {
  HISTORY_WINDOWS, formatHistorySpan, mergeHistoryWindow, type HistoryWindowId,
} from './history.ts'
import type { Snapshot, Unit } from './telemetry.ts'

use([AriaComponent, GridComponent, LegendComponent, MarkLineComponent, LineChart, TooltipComponent, CanvasRenderer])

type Channel = 'food_core' | 'ambient'
const colors = ['#67ddc7', '#8eb9ff', '#e5a2f5', '#ffbe76']

type Timeline = { start: number; end: number; playhead: number; events: { time: number; label: string }[] }

export default function TemperatureChart({ history, unit, saved = false, timeline }: {
  history: Snapshot[]; unit: Unit; saved?: boolean; timeline?: Timeline
}) {
  const titleId = useId()
  const container = useRef<HTMLDivElement>(null)
  const chart = useRef<EChartsType>(null)
  const [channel, setChannel] = useState<Channel>('food_core')
  const [windowId, setWindowId] = useState<HistoryWindowId>('10m')
  const [serverHistory, setServerHistory] = useState<{ snapshots: Snapshot[]; bucketSeconds: number }>({
    snapshots: [], bucketSeconds: 2,
  })
  const selectedWindow = HISTORY_WINDOWS.find((option) => option.id === windowId) ?? HISTORY_WINDOWS[1]
  const latestFeed = history.at(-1)
  const feedKey = latestFeed ? `${latestFeed.source}:${latestFeed.device_id}` : ''

  useEffect(() => {
    if (saved) return
    const controller = new AbortController()
    const seconds = Math.round(selectedWindow.ms / 1000)
    fetch(`/api/v1/telemetry/history?window_seconds=${seconds}`, {
      cache: 'no-store', signal: controller.signal,
    })
      .then((response) => response.ok ? response.json() : null)
      .then((body: { snapshots?: Snapshot[]; bucket_seconds?: number } | null) => {
        if (!controller.signal.aborted && body && Array.isArray(body.snapshots)) {
          setServerHistory({ snapshots: body.snapshots, bucketSeconds: body.bucket_seconds ?? 2 })
        }
      })
      .catch(() => {})
    return () => controller.abort()
  }, [feedKey, saved, selectedWindow.ms])

  const nowMs = Date.now()
  const { snapshots: visibleHistory, stride, recentCutoff } = saved
    ? { snapshots: history, stride: 1, recentCutoff: 0 }
    : mergeHistoryWindow(serverHistory.snapshots, history, selectedWindow.ms, nowMs)

  const validTimestamps = visibleHistory.flatMap((snapshot) => (
    snapshot.readings.some((entry) => entry.sensor_type === channel && entry.quality === 'valid')
      ? [Date.parse(snapshot.observed_at)]
      : []
  ))
  const earliestValid = validTimestamps[0]
  const anchorNow = Math.max(nowMs, validTimestamps.at(-1) ?? 0)
  const sourceLabel = (visibleHistory.at(-1) ?? latestFeed)?.source === 'simulator' ? 'Simulated readings' : 'Probe readings'

  let subtitle = `Saved cook history · ${sourceLabel}`
  if (!saved) {
    if (earliestValid === undefined) {
      subtitle = `No valid readings in the last ${selectedWindow.label} · ${sourceLabel}`
    } else {
      const spanMs = Math.min(selectedWindow.ms, Math.max(0, anchorNow - earliestValid))
      subtitle = spanMs < selectedWindow.ms * 0.9
        ? `Showing last ${formatHistorySpan(spanMs)} (of ${selectedWindow.label} requested) · ${sourceLabel}`
        : `Last ${selectedWindow.label} · ${sourceLabel}`
    }
  }

  useEffect(() => {
    const element = container.current
    if (!element) return
    const instance = init(element, undefined, { renderer: 'canvas' })
    chart.current = instance
    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(element)
    return () => {
      observer.disconnect()
      instance.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    const latest = visibleHistory.at(-1) ?? latestFeed
    const series: LineSeriesOption[] = (latest?.probes ?? []).map((probe, index) => ({
      name: probe.name,
      type: 'line',
      markLine: index === 0 && timeline ? {
        symbol: 'none',
        animation: false,
        label: { show: false },
        data: [
          ...timeline.events.map((event) => ({
            xAxis: event.time, name: event.label, lineStyle: { color: '#ffbe76' },
          })),
          { xAxis: timeline.playhead, name: 'Replay position', lineStyle: { color: '#ffffff', type: 'solid' } },
        ],
      } : undefined,
      showSymbol: visibleHistory.length < 3,
      data: visibleHistory.flatMap((snapshot, index) => {
        const timestamp = Date.parse(snapshot.observed_at)
        const reading = snapshot.readings.find((entry) => (
          entry.probe_id === probe.id && entry.sensor_type === channel && entry.quality === 'valid'
        ))
        const raw = reading?.temperature_c
        const value = raw == null ? null : Number((unit === 'F' ? raw * 9 / 5 + 32 : raw).toFixed(1))
        const previous = visibleHistory[index - 1]
        if (previous) {
          const previousTs = Date.parse(previous.observed_at)
          const cadence = !saved && previousTs < recentCutoff ? 30000 : 2000
          const serverGap = !saved ? serverHistory.bucketSeconds * 1000 * 3 : 6000
          const gapLimit = saved ? 6000 : Math.max(6000, serverGap, cadence * stride * 3)
          if (timestamp - previousTs > gapLimit) {
            return [[timestamp - 1, null], [timestamp, value]]
          }
        }
        return [[timestamp, value]]
      }),
    }))
    chart.current?.setOption({
      aria: { enabled: true },
      color: colors,
      textStyle: { color: '#d1dbe4' },
      tooltip: { trigger: 'axis' },
      legend: { textStyle: { color: '#d1dbe4' } },
      grid: { left: 60, right: 22, top: 52, bottom: 34 },
      xAxis: { type: 'time', min: timeline?.start, max: timeline?.end, axisLabel: { color: '#c0cbd6', hideOverlap: true } },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { color: '#c0cbd6', formatter: `{value}°${unit}` },
        splitLine: { lineStyle: { color: '#374655' } },
      },
      series,
    }, { replaceMerge: ['series'] })
  }, [channel, latestFeed, recentCutoff, saved, serverHistory.bucketSeconds, stride, timeline, unit, visibleHistory])

  return (
    <section className="history" aria-labelledby={titleId}>
      <div className="history-header">
        <div>
          <h2 id={titleId}>{saved ? "Saved temperatures" : "Recent temperatures"}</h2>
          <p>{subtitle}</p>
        </div>
        <div className="session-controls">
          {!saved && (
            <label>
              Window
              <select value={windowId} onChange={(event) => setWindowId(event.target.value as HistoryWindowId)}>
                {HISTORY_WINDOWS.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            Channel
            <select value={channel} onChange={(event) => setChannel(event.target.value as Channel)}>
              <option value="food_core">Food core</option>
              <option value="ambient">Ambient</option>
            </select>
          </label>
        </div>
      </div>
      <div ref={container} className="temperature-chart" />
    </section>
  )
}
