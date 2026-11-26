import type { PointerEvent } from 'react'
import type { Layout } from './equipment.ts'

type Selection = { kind: 'food' | 'probes'; index: number }

export default function ChamberPlan({ layout, selection, onSelect, onPosition }: {
  layout: Layout
  selection?: Selection
  onSelect?: (selection: Selection) => void
  onPosition?: (event: PointerEvent<HTMLDivElement>) => void
}) {
  const percent = (value: number, axis: 'width_mm' | 'depth_mm') => `${value / Math.max(layout[axis], 1) * 100}%`
  const aspect = Math.max(layout.width_mm, 1) / Math.max(layout.depth_mm, 1)

  return (
    <div className={`chamber-plan ${layout.shape}`}
      style={{ aspectRatio: aspect, maxWidth: Math.min(620, 520 * aspect) }}
      onPointerDown={onPosition} role="group" aria-label="Top-down chamber layout">
      {layout.food.map((item, index) => {
        const style = {
          left: percent(item.x_mm, 'width_mm'), top: percent(item.y_mm, 'depth_mm'),
          width: percent(item.width_mm, 'width_mm'), height: percent(item.depth_mm, 'depth_mm'),
          transform: `translate(-50%, -50%) rotate(${item.angle_deg}deg)`,
        }
        return onSelect ? (
          <button type="button" key={item.id} className="food-marker"
            aria-pressed={selection?.kind === 'food' && selection.index === index}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onSelect({ kind: 'food', index })} style={style}>{item.name}</button>
        ) : <span key={item.id} className="food-marker saved-food" style={style}>{item.name}</span>
      })}
      {layout.probes.map((probe, index) => (
        <div className="probe-marker" key={probe.probe_id} style={{
          left: percent(probe.x_mm, 'width_mm'), top: percent(probe.y_mm, 'depth_mm'),
          width: percent(probe.insertion_mm, 'width_mm'), transform: `rotate(${probe.angle_deg}deg)`,
        }}>
          {onSelect ? (
            <button type="button" aria-label={probe.probe_id}
              aria-pressed={selection?.kind === 'probes' && selection.index === index}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onSelect({ kind: 'probes', index })}>●</button>
          ) : <span className="saved-probe">● {probe.probe_id}</span>}
        </div>
      ))}
    </div>
  )
}
