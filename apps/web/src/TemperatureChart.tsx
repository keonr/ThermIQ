import { useEffect, useId, useRef, useState } from 'react'
import { LineChart, type LineSeriesOption } from 'echarts/charts'
import {
  AriaComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent,
} from 'echarts/components'
import { init, use, type EChartsType } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { HISTORY_WINDOWS, sliceHistoryWindow, type HistoryWindowId } from './history.ts'
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
  const selectedWindow = HISTORY_WINDOWS.find((option) => option.id === windowId) ?? HISTORY_WINDOWS[1]

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
    const { snapshots: visibleHistory, stride, recentCutoff } = saved
      ? { snapshots: history, stride: 1, recentCutoff: 0 }
      : sliceHistoryWindow(history, selectedWindow.ms)
    const latest = visibleHistory.at(-1)
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
          const gapLimit = saved ? 6000 : Math.max(6000, cadence * stride * 3)
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
  }, [channel, history, saved, selectedWindow.ms, timeline, unit])

  return (
    <section className="history" aria-labelledby={titleId}>
      <div className="history-header">
        <div>
          <h2 id={titleId}>{saved ? "Saved temperatures" : "Recent temperatures"}</h2>
          <p>{saved ? "Saved cook history" : `Last ${selectedWindow.label} in this tab`} · {history.at(-1)?.source === 'simulator' ? 'Simulated readings' : 'Probe readings'}</p>
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
