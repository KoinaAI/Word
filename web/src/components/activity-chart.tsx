import { AreaChart } from '@heroui-pro/react/area-chart'
import type { Activity } from '@/lib/types'
import { dayLabel } from '@/lib/utils'

export function ActivityChart({ activity }: { activity: Activity[] }) {
  return <AreaChart data={activity.map(item => ({ ...item, date: dayLabel(item.date) }))} height={190} margin={{ left: -28, right: 6, top: 18, bottom: 0 }}><defs><linearGradient id="activity-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity={0.19} /><stop offset="100%" stopColor="var(--accent)" stopOpacity={0} /></linearGradient></defs><AreaChart.Grid vertical={false} strokeDasharray="3 4" /><AreaChart.XAxis dataKey="date" minTickGap={28} tickMargin={10} /><AreaChart.YAxis allowDecimals={false} tickCount={4} /><AreaChart.Area dataKey="count" name="学习次数" type="monotone" stroke="var(--accent)" strokeWidth={2.5} fill="url(#activity-fill)" isAnimationActive={false} /><AreaChart.Tooltip content={<AreaChart.TooltipContent />} /></AreaChart>
}
