import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Chip, Input, Label, Switch, TextField } from '@heroui/react'
import { NativeSelect } from '@heroui-pro/react'
import { ArrowDown, ArrowUp } from '@gravity-ui/icons'
import { toast } from 'sonner'
import { Failure, IconButton, Loading, PageHeading } from '@/components/shared'
import { api, json } from '@/lib/api'
import type { Navigation } from '@/lib/types'

const iconOptions = [
  { value: 'chart-column', label: '统计图表' }, { value: 'book-open', label: '词书' },
  { value: 'persons', label: '用户' }, { value: 'sliders', label: '设置' },
]

function NavigationEditor({ initial }: { initial: Navigation[] }) {
  const client = useQueryClient()
  const [items, setItems] = useState(() => initial.map(item => ({ ...item })).sort((a, b) => a.sortOrder - b.sortOrder))
  const [saved, setSaved] = useState(initial)
  const normalized = items.map((item, index) => ({ ...item, sortOrder: index }))
  const dirty = JSON.stringify(normalized) !== JSON.stringify(saved.map((item, index) => ({ ...item, sortOrder: index })))
  const mutation = useMutation({
    mutationFn: () => api<Navigation[]>('/admin/navigation', json('PUT', { items: normalized })),
    onSuccess: data => {
      setItems(data.map(item => ({ ...item }))); setSaved(data)
      client.setQueryData(['admin', 'navigation'], data)
      void client.invalidateQueries({ queryKey: ['admin', 'navigation'] })
      toast.success('导航已更新，侧栏与路由立即生效')
    },
  })
  const update = (id: string, values: Partial<Pick<Navigation, 'label' | 'icon' | 'enabled'>>) => setItems(current => current.map(item => item.id === id ? { ...item, ...values } : item))
  const move = (index: number, direction: -1 | 1) => setItems(current => {
    const reordered = [...current]
    const destination = index + direction
    if (destination >= 0 && destination < reordered.length) [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]]
    return reordered
  })
  return <div className="space-y-6">
    <PageHeading eyebrow="站点设置" title="导航配置" description="调整后台入口，保存后立即更新导航与可访问页面。" action={<Button isPending={mutation.isPending} isDisabled={!dirty || items.some(item => !item.label.trim())} onPress={() => mutation.mutate()}>保存配置</Button>} />
    <div className="space-y-4">
      {items.map((item, index) => <Card key={item.id} className="p-5">
        <div className="grid items-center gap-4 md:grid-cols-[1fr_160px_auto]">
          <div className="min-w-0 space-y-2"><div className="flex items-center gap-2"><TextField className="max-w-sm flex-1" value={item.label} onChange={value => update(item.id, { label: value })} isDisabled={mutation.isPending} isRequired><Label className="sr-only">{item.path} 导航名称</Label><Input variant="secondary" maxLength={40} /></TextField>{item.id === 'navigation' && <Chip size="sm" variant="soft">常驻</Chip>}</div><p className="font-mono text-xs text-muted">{item.path}</p></div>
          <NativeSelect variant="secondary"><NativeSelect.Trigger aria-label={`${item.label}图标`} value={item.icon} disabled={mutation.isPending} onChange={event => update(item.id, { icon: event.target.value })}>{iconOptions.map(icon => <NativeSelect.Option key={icon.value} value={icon.value}>{icon.label}</NativeSelect.Option>)}<NativeSelect.Indicator /></NativeSelect.Trigger></NativeSelect>
          <div className="flex items-center justify-end gap-2"><IconButton label={`上移${item.label}`} isDisabled={index === 0 || mutation.isPending} onPress={() => move(index, -1)}><ArrowUp /></IconButton><IconButton label={`下移${item.label}`} isDisabled={index === items.length - 1 || mutation.isPending} onPress={() => move(index, 1)}><ArrowDown /></IconButton><Switch aria-label={`启用${item.label}`} isSelected={item.enabled} onChange={enabled => update(item.id, { enabled })} isDisabled={item.id === 'navigation' || mutation.isPending}><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control></Switch.Content></Switch></div>
        </div>
      </Card>)}
    </div>
    <div className="flex flex-wrap items-start justify-between gap-4"><p className="max-w-xl text-sm leading-6 text-muted">导航设置入口始终保留，便于重新启用其他模块。关闭入口不会删除词书或用户数据。</p><Button variant="secondary" isDisabled={!dirty || mutation.isPending} onPress={() => { setItems(saved.map(item => ({ ...item }))); mutation.reset() }}>撤销未保存修改</Button></div>
    {mutation.isError && <p role="alert" className="text-sm text-danger">{mutation.error.message}</p>}
  </div>
}

export function AdminNavigation() {
  const query = useQuery({ queryKey: ['admin', 'navigation'], queryFn: () => api<Navigation[]>('/admin/navigation') })
  if (query.isPending) return <Loading label="正在加载导航配置" />
  if (query.isError) return <Failure error={query.error} retry={query.refetch} />
  return <NavigationEditor initial={query.data} />
}
