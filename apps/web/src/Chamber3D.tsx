import { Canvas } from '@react-three/fiber'
import { Edges, OrbitControls } from '@react-three/drei'
import type { Layout } from './equipment.ts'

function Chamber({ layout }: { layout: Layout }) {
  const scale = Math.max(layout.width_mm, layout.depth_mm, layout.height_mm)
  const width = layout.width_mm / scale
  const depth = layout.depth_mm / scale
  const height = layout.height_mm / scale

  return (
    <>
      <mesh position={[0, height / 2, 0]}>
        {layout.shape === 'cylindrical'
          ? <cylinderGeometry args={[width / 2, width / 2, height, 48]} />
          : <boxGeometry args={[width, height, depth]} />}
        <meshBasicMaterial color="#78919e" transparent opacity={0} depthWrite={false} />
        <Edges color="#89a4b4" threshold={layout.shape === 'cylindrical' ? 10 : 15} />
      </mesh>
      {layout.food.map((food) => (
        <mesh key={food.id}
          position={[food.x_mm / scale - width / 2, 0.005, food.y_mm / scale - depth / 2]}
          rotation={[-Math.PI / 2, 0, -food.angle_deg * Math.PI / 180]}>
          <planeGeometry args={[food.width_mm / scale, food.depth_mm / scale]} />
          <meshBasicMaterial color="#b67959" side={2} />
        </mesh>
      ))}
      {layout.probes.map((probe) => {
        const angle = probe.angle_deg * Math.PI / 180
        const length = probe.insertion_mm / scale
        const x = probe.x_mm / scale - width / 2
        const z = probe.y_mm / scale - depth / 2
        return (
          <group key={probe.probe_id} position={[x, 0.012, z]} rotation={[0, -angle, 0]}>
            <mesh position={[length / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.005, 0.005, length, 8]} />
              <meshBasicMaterial color="#8de8d6" />
            </mesh>
            <mesh>
              <sphereGeometry args={[0.012, 12, 8]} />
              <meshBasicMaterial color="#f3f9ff" />
            </mesh>
          </group>
        )
      })}
    </>
  )
}

export default function Chamber3D({ layout }: { layout: Layout }) {
  return (
    <div className="chamber-three" aria-label="Interactive 3D chamber">
      <Canvas camera={{ position: [1.5, 1.35, 1.5], fov: 45 }}
        dpr={[1, 1.5]} frameloop="demand" fallback={<p>3D rendering is unavailable in this browser.</p>}>
        <Chamber layout={layout} />
        <OrbitControls makeDefault target={[0, 0.25, 0]} minDistance={0.25} maxDistance={6} />
      </Canvas>
    </div>
  )
}
