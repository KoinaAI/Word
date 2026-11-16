import type { ReactNode } from 'react'
import { KPI } from '@heroui-pro/react/kpi'

export function StatCard({ title, value, foot, icon }: { title: string; value: number; foot: string; icon: ReactNode }) {
  return <KPI className="metric-card"><KPI.Header><KPI.Title>{title}</KPI.Title><span className="metric-icon">{icon}</span></KPI.Header><KPI.Content><KPI.Value value={value} /></KPI.Content><KPI.Footer>{foot}</KPI.Footer></KPI>
}
