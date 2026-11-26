import { useEffect, useMemo, useRef } from 'react'
import type { Layout } from './equipment.ts'
import { ambientPoints, convexHull, distinctSites, estimateAt, type TemperaturePoint } from './heatMap.ts'
import { formatTemperature, type Snapshot, type Unit } from './telemetry.ts'

export default function ChamberHeatMap({ layout, snapshot, playhead, layoutSince, unit }: {
  layout: Layout; snapshot?: Snapshot; playhead: number; layoutSince: number; unit: Unit
}) {
  const points = ambientPoints(layout, snapshot, playhead, layoutSince)
  return <HeatMapPlot layout={layout} points={points} unit={unit}
    title="Ambient heat map" simulated={snapshot?.source === 'simulator'}
    emptyMessage="No recent ambient samples from placed probes at this position." />
}

export function HeatMapPlot({ layout, points, unit, title, simulated, emptyMessage }: {
  layout: Layout; points: (TemperaturePoint & { id: string })[]; unit: Unit
  title: string; simulated: boolean; emptyMessage: string
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  // Keep the drawing stable between replay frames when the eligible readings are unchanged.
  const pointKey = JSON.stringify(points)
  const sites = useMemo(() => distinctSites(JSON.parse(pointKey)), [pointKey])
  const hull = useMemo(() => convexHull(sites), [sites])
  const widthMm = layout.width_mm
  const depthMm = layout.depth_mm
  const aspect = widthMm / depthMm
  const width = Math.max(1, Math.round(Math.min(520, 360 * aspect)))
  const height = Math.max(1, Math.round(Math.min(360, 520 / aspect)))
  const low = Math.min(...sites.map((site) => site.celsius))
  const high = Math.max(...sites.map((site) => site.celsius))

  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, width, height)
    const scaleX = width / widthMm
    const scaleY = height / depthMm
    function tone(celsius: number) {
      const fraction = high === low ? 0.5 : (celsius - low) / (high - low)
      return `hsl(${220 - 205 * fraction} 88% 57%)`
    }

    if (hull.length >= 3) {
      context.save()
      context.beginPath()
      for (const [index, point] of hull.entries()) {
        if (index === 0) context.moveTo(point.x * scaleX, point.y * scaleY)
        else context.lineTo(point.x * scaleX, point.y * scaleY)
      }
      context.closePath()
      context.clip()
      const diagonal = Math.hypot(widthMm, depthMm)
      const step = 5
      for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
          const result = estimateAt(sites, { x: (x + step / 2) / scaleX, y: (y + step / 2) / scaleY },
            Math.max(1, diagonal * 0.02))
          context.fillStyle = tone(result.celsius)
          context.globalAlpha = Math.max(0.28, 1 - result.distanceMm / (diagonal * 0.55))
          context.fillRect(x, y, step, step)
        }
      }
      context.restore()
    } else if (sites.length === 2) {
      const [a, b] = sites
      const gradient = context.createLinearGradient(a.x * scaleX, a.y * scaleY, b.x * scaleX, b.y * scaleY)
      gradient.addColorStop(0, tone(a.celsius))
      gradient.addColorStop(1, tone(b.celsius))
      context.strokeStyle = gradient
      context.lineWidth = 4
      context.beginPath()
      context.moveTo(a.x * scaleX, a.y * scaleY)
      context.lineTo(b.x * scaleX, b.y * scaleY)
      context.stroke()
    }

    for (const site of sites) {
      context.beginPath()
      context.arc(site.x * scaleX, site.y * scaleY, 4, 0, 2 * Math.PI)
      context.fillStyle = tone(site.celsius)
      context.fill()
      context.strokeStyle = 'white'
      context.lineWidth = 1.5
      context.stroke()
    }
  }, [depthMm, height, high, hull, low, sites, width, widthMm])

  return (
    <section aria-label={title}>
      <h4>{title}</h4>
      {points.length === 0 ? <p>{emptyMessage}</p> : (
        <>
          {simulated && <p>Simulated probe data</p>}
          <canvas className={`replay-heat-map ${layout.shape}`} ref={canvas} width={width} height={height}
            aria-label="Top-down ambient readings and estimated heat distribution" role="img" />
          <p>{hull.length >= 3
            ? 'Estimated temperatures between probes. Faded cells are farther from a probe. Blank areas are outside coverage.'
            : sites.length === 2 ? 'Limited gradient along the line between two probe positions.'
              : 'Point readings only. A chamber estimate requires at least three non-collinear probe positions.'}</p>
          {sites.length > 1 && <p>Color scale: {formatTemperature(low, unit)} to {formatTemperature(high, unit)}</p>}
          <ul>
            {points.map((point) => <li key={point.id}>{point.id} · {formatTemperature(point.celsius, unit)}</li>)}
          </ul>
          <p>Probe entry points approximate ambient sensor positions.</p>
        </>
      )}
    </section>
  )
}
