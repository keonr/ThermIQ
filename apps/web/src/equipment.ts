export type Point = { x_mm: number; y_mm: number; angle_deg: number }
export type Food = Point & { id: string; name: string; width_mm: number; depth_mm: number }
export type Probe = Point & { probe_id: string; insertion_mm: number }
export type Layout = {
  name: string; shape: 'rectangular' | 'cylindrical'
  width_mm: number; depth_mm: number; height_mm: number
  food: Food[]; probes: Probe[]
}
export type Profile = Layout & { id: string }

export const equipmentEndpoint = '/api/v1/equipment'

export async function equipmentRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(equipmentEndpoint + path, options)
  const body = await response.json()
  if (!response.ok) {
    const detail = typeof body.detail === 'string' ? body.detail : body.detail?.[0]?.msg
    throw new Error(detail ?? 'Could not save or load equipment.')
  }
  return body
}
