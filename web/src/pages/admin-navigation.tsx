import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Chip, Input, Label, Switch, TextField } from '@heroui/react'
import { NativeSelect } from '@heroui-pro/react/native-select'
import { ArrowDown, ArrowUp } from '@gravity-ui/icons'
import { toast } from 'sonner'
import { Failure, IconButton, Loading, PageHeading } from '@/components/shared'
import { ApiError, api, json, useUser } from '@/lib/api'
import { useFormDraft } from '@/hooks/use-form-draft'
import type { Navigation } from '@/lib/types'

type NavigationState = { items: Navigation[]; version: number }
const iconOptions = [
  { value: 'chart-column', label: '统计图表' }, { value: 'book-open', label: '词书' },
  { value: 'persons', label: '用户' }, { value: 'sliders', label: '设置' },
]

function NavigationEditor({ initial }: { initial: NavigationState }) {
  const client = useQueryClient()
  const { data: user } = useUser()
  const draft = useFormDraft(`word-draft:${user?.id}:navigation`, { ...initial, items: [...initial.items].sort((a, b) => a.sortOrder - b.sortOrder) })
  const items = draft.value.items
  const [reloading, setReloading] = useState(false)
  const [reloadError, setReloadError] = useState('')
  const normalized = items.map((item, index) => ({ ...item, sortOrder: index }))
  const remoteChanged = initial.version > draft.value.version
  const mutation = useMutation({
    mutationFn: () => api<NavigationState>('/admin/navigation', json('PUT', { items: normalized, version: draft.value.version })),
    onSuccess: data => {
      draft.reset(data)
      client.setQueryData(['admin', 'navigation'], data.items)
      client.setQueryData(['admin', 'navigation', 'versioned'], data)
      void client.invalidateQueries({ queryKey: ['admin', 'navigation'] })
      toast.success('导航已更新，侧栏与路由立即生效')
    },
  })
  useEffect(() => {
    if (!draft.dirty && initial.version > draft.value.version) draft.reset(initial)
  }, [initial.version, draft.dirty])
  const update = (id: string, values: Partial<Pick<Navigation, 'label' | 'icon' | 'enabled'>>) => draft.setValue(current => ({ ...current, items: current.items.map(item => item.id === id ? { ...item, ...values } : item) }))
  const move = (index: number, direction: -1 | 1) => draft.setValue(current => {
    const reordered = [...current.items]
    const destination = index + direction
    if (destination >= 0 && destination < reordered.length) [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]]
    return { ...current, items: reordered }
  })
  const reload = async () => {
    setReloading(true); setReloadError('')
    try {
      const latest = await api<NavigationState>('/admin/navigation?versioned=1')
      draft.reset(latest)
      client.setQueryData(['admin', 'navigation', 'versioned'], latest)
      client.setQueryData(['admin', 'navigation'], latest.items)
      mutation.reset()
    } catch (error) { setReloadError((error as Error).message) } finally { setReloading(false) }
  }
  const conflict = remoteChanged || mutation.error instanceof ApiError && mutation.error.status === 409
  return <div className="space-y-6">
    <PageHeading eyebrow="站点设置" title="导航配置" description="调整后台入口，保存后立即更新导航与可访问页面。" action={<Button isPending={mutation.isPending} isDisabled={!draft.dirty || conflict || items.some(item => !item.label.trim())} onPress={() => mutation.mutate()}>保存配置</Button>} />
    {draft.restored && <p role="status" className="text-sm text-muted">已恢复未保存配置。离开页面会保留草稿，保存前将检查是否有其他管理员更新。</p>}{draft.storageError && <p role="alert" className="text-sm text-danger">{draft.storageError}</p>}
    {conflict && <Card variant="secondary" className="p-4"><Card.Header><Card.Title>配置已被更新</Card.Title><Card.Description>当前草稿仍保留。请先复制需要保留的内容，再载入最新配置；系统不会覆盖其他管理员的修改。</Card.Description></Card.Header><Card.Footer><Button variant="secondary" isPending={reloading} onPress={() => { void reload() }}>放弃草稿并载入最新配置</Button></Card.Footer></Card>}
    <div className="space-y-4">
      {items.map((item, index) => <Card key={item.id} className="p-5">
        <div className="grid items-center gap-4 md:grid-cols-[1fr_160px_auto]">
          <div className="min-w-0 space-y-2"><div className="flex items-center gap-2"><TextField className="max-w-sm flex-1" value={item.label} onChange={value => update(item.id, { label: value })} isDisabled={mutation.isPending || reloading} isRequired><Label className="sr-only">{item.path} 导航名称</Label><Input variant="secondary" maxLength={40} /></TextField>{item.id === 'navigation' && <Chip size="sm" variant="soft">常驻</Chip>}</div><p className="font-mono text-xs text-muted">{item.path}</p></div>
          <NativeSelect variant="secondary"><NativeSelect.Trigger aria-label={`${item.label}图标`} value={item.icon} disabled={mutation.isPending || reloading} onChange={event => update(item.id, { icon: event.target.value })}>{iconOptions.map(icon => <NativeSelect.Option key={icon.value} value={icon.value}>{icon.label}</NativeSelect.Option>)}<NativeSelect.Indicator /></NativeSelect.Trigger></NativeSelect>
          <div className="flex items-center justify-end gap-2"><IconButton label={`上移${item.label}`} isDisabled={index === 0 || mutation.isPending || reloading} onPress={() => move(index, -1)}><ArrowUp /></IconButton><IconButton label={`下移${item.label}`} isDisabled={index === items.length - 1 || mutation.isPending || reloading} onPress={() => move(index, 1)}><ArrowDown /></IconButton><Switch aria-label={`启用${item.label}`} isSelected={item.enabled} onChange={enabled => update(item.id, { enabled })} isDisabled={item.id === 'navigation' || mutation.isPending || reloading}><Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control></Switch.Content></Switch></div>
        </div>
      </Card>)}
    </div>
    <div className="flex flex-wrap items-start justify-between gap-4"><p className="max-w-xl text-sm leading-6 text-muted">导航设置入口始终保留。未保存修改暂存于当前标签页，关闭入口不会删除学习数据。</p><Button variant="secondary" isDisabled={!draft.dirty || mutation.isPending || reloading} onPress={() => { draft.reset(initial); mutation.reset() }}>撤销未保存修改</Button></div>
    {(mutation.isError || reloadError) && <p role="alert" className="text-sm text-danger">{reloadError || mutation.error?.message}</p>}
  </div>
}

export function AdminNavigation() {
  const query = useQuery({ queryKey: ['admin', 'navigation', 'versioned'], queryFn: ({ signal }) => api<NavigationState>('/admin/navigation?versioned=1', { signal }) })
  if (query.isPending) return <Loading label="正在加载导航配置" />
  if (query.isError) return <Failure error={query.error} retry={query.refetch} />
  return <NavigationEditor initial={query.data} />
}
