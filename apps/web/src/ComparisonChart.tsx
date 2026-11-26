import { useEffect, useRef } from 'react'
import { LineChart } from 'echarts/charts'
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { init, use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import type { Unit } from './telemetry.ts'

use([AriaComponent, GridComponent, LegendComponent, TooltipComponent, LineChart, CanvasRenderer])

export default function ComparisonChart({ unit, series }: {
  unit: Unit; series: { name: string; values: [number, number | null][] }[]
}) {
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = container.current
    if (!element) return
    const chart = init(element)
    chart.setOption({
      aria: { enabled: true },
      textStyle: { color: '#d1dbe4' },
      legend: { type: 'scroll', textStyle: { color: '#d1dbe4' } },
      tooltip: { trigger: 'axis' },
      grid: { left: 64, right: 24, top: 48, bottom: 48 },
      xAxis: { type: 'value', name: 'Elapsed minutes', nameLocation: 'middle', nameGap: 26, min: 0 },
      yAxis: { type: 'value', scale: true, axisLabel: { formatter: `{value}°${unit}` } },
      series: series.map(({ name, values }) => ({
        name, type: 'line', showSymbol: values.length === 1,
        data: values.map(([time, celsius]) => [
          time, celsius === null ? null : Number((unit === 'F' ? celsius * 1.8 + 32 : celsius).toFixed(1)),
        ]),
      })),
    })
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(element)
    return () => {
      observer.disconnect()
      chart.dispose()
    }
  }, [series, unit])

  return series.length ? <div ref={container} className="temperature-chart" /> : <p>No samples for this channel.</p>
}
