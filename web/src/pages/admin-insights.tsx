import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Button, Card, Chip, Input } from '@heroui/react'
import { DataGrid, type DataGridColumn } from '@heroui-pro/react/data-grid'
import { NativeSelect } from '@heroui-pro/react/native-select'
import { BookOpen, ChartColumn, Persons, Pulse } from '@gravity-ui/icons'
import { ActivityChart, Empty, Failure, Loading, PageHeading, Stat } from '@/components/shared'
import { api } from '@/lib/api'
import type { AdminStats, AdminUser, Recent } from '@/lib/types'
import { count } from '@/lib/utils'
import { adminDate } from './admin-common'

const answerLabels: Record<string, string> = {
  known: '答对', unknown: '未记住', 'unsure-known': '加入巩固', 'unsure-unknown': '仍需学习',
}

export function AdminOverview() {
  const query = useQuery({ queryKey: ['admin', 'stats'], queryFn: () => api<AdminStats>('/admin/stats') })
  const columns: DataGridColumn<Recent>[] = [
    { id: 'text', header: '单词', accessorKey: 'text', isRowHeader: true, minWidth: 150, cell: item => <span className="font-medium">{item.text}</span> },
    { id: 'meaning', header: '释义', accessorKey: 'meaning', minWidth: 200 },
    { id: 'answer', header: '学习反馈', minWidth: 110, cell: item => <Chip size="sm" variant="soft" color={item.answer === 'known' ? 'success' : 'default'}>{answerLabels[item.answer] || item.answer}</Chip> },
    { id: 'createdAt', header: '时间 · UTC', accessorKey: 'createdAt', minWidth: 160, cell: item => <span className="tabular-nums text-muted">{adminDate(item.createdAt)}</span> },
  ]
  if (query.isPending) return <Loading label="正在加载站点数据" />
  if (query.isError) return <Failure error={query.error} retry={query.refetch} />
  const stats = query.data
  return <div className="space-y-6">
    <PageHeading eyebrow="管理工作台" title="站点概览" description="看见每一次学习，让内容与体验持续生长。" action={<Button variant="secondary" isPending={query.isFetching} onPress={() => { void query.refetch() }}>刷新数据</Button>} />
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <Stat title="累计用户" value={stats.users} foot="包含独立访客账户" icon={<Persons />} />
      <Stat title="今日活跃" value={stats.activeToday} foot="今日有学习记录的用户" icon={<Pulse />} />
      <Stat title="词库总量" value={stats.words} foot={`${count(stats.books)} 本词书`} icon={<BookOpen />} />
      <Stat title="累计学习" value={stats.answers} foot="已记录的学习反馈次数" icon={<ChartColumn />} />
    </div>
    <Card className="p-6">
      <Card.Header><Card.Title>学习趋势</Card.Title><Card.Description>按日汇总站点学习次数 · UTC</Card.Description></Card.Header>
      <Card.Content><ActivityChart activity={stats.activity} /></Card.Content>
    </Card>
    <section className="space-y-4">
      <div><h2 className="text-base font-semibold">最近学习动态</h2><p className="mt-1 text-sm text-muted">来自站点的最新真实学习记录</p></div>
      <DataGrid aria-label="最近学习动态" data={stats.recent} columns={columns} getRowId={item => item.id} selectionMode="none" variant="secondary" contentClassName="min-w-[640px]" scrollContainerClassName="max-h-[420px] overflow-auto" stickyHeader renderEmptyState={() => <Empty title="学习即将发生" description="有人完成第一张单词卡片后，记录会出现在这里。" />} />
    </section>
  </div>
}

export function AdminUsers() {
  const pageSize = 50
  const [filters, setFilters] = useState({ search: '', kind: 'all', offset: 0 })
  const query = useQuery({
    queryKey: ['admin', 'users', filters.search.trim(), filters.kind, filters.offset],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ paged: '1', q: filters.search.trim(), kind: filters.kind, offset: String(filters.offset), limit: String(pageSize) })
      return api<{ items: AdminUser[]; total: number; hasMore: boolean; offset: number; limit: number }>(`/admin/users?${params}`, { signal })
    },
    placeholderData: keepPreviousData,
  })
  const users = query.data?.items || []
  const total = query.data?.total || 0
  const columns: DataGridColumn<AdminUser>[] = [
    { id: 'name', header: '用户', accessorKey: 'name', isRowHeader: true, minWidth: 220, cell: user => <div className="py-1"><div className="font-medium">{user.name}</div><div className="mt-1 text-xs text-muted">{user.email || `访客 #${user.id}`}</div></div> },
    { id: 'role', header: '账户类型', minWidth: 130, cell: user => <Chip variant="soft" size="sm" color={user.role === 'admin' ? 'accent' : 'default'}>{user.role === 'admin' ? '管理员' : user.guest ? '访客' : '注册用户'}</Chip> },
    { id: 'learnedCount', header: '已掌握', accessorKey: 'learnedCount', align: 'end', minWidth: 100, cell: user => <span className="tabular-nums">{count(user.learnedCount)} 词</span> },
    { id: 'dailyGoal', header: '每轮新词', accessorKey: 'dailyGoal', align: 'end', minWidth: 100, cell: user => <span className="tabular-nums text-muted">{user.dailyGoal} 词</span> },
    { id: 'createdAt', header: '加入时间 · UTC', accessorKey: 'createdAt', minWidth: 160, cell: user => <span className="tabular-nums text-muted">{adminDate(user.createdAt)}</span> },
  ]
  return <div className="space-y-6">
    <PageHeading eyebrow="管理工作台" title="用户管理" description="搜索学习者，查看账户类型与学习进度。" />
    <div className="flex flex-wrap items-center gap-3">
      <Input aria-label="搜索用户" placeholder="搜索昵称或邮箱" className="min-w-48 max-w-sm flex-1" value={filters.search} onChange={event => setFilters(current => ({ ...current, search: event.target.value, offset: 0 }))} />
      <NativeSelect className="w-36"><NativeSelect.Trigger aria-label="账户类型" value={filters.kind} onChange={event => setFilters(current => ({ ...current, kind: event.target.value, offset: 0 }))}>
        <NativeSelect.Option value="all">全部账户</NativeSelect.Option><NativeSelect.Option value="registered">注册用户</NativeSelect.Option><NativeSelect.Option value="guest">访客</NativeSelect.Option><NativeSelect.Option value="admin">管理员</NativeSelect.Option><NativeSelect.Indicator />
      </NativeSelect.Trigger></NativeSelect>
      <span className="ml-auto text-sm tabular-nums text-muted" aria-live="polite">{query.isFetching ? '正在更新…' : `共 ${count(total)} 位用户`}</span>
    </div>
    {query.isPending ? <Loading label="正在加载用户列表" /> : query.isError ? <Failure error={query.error} retry={query.refetch} /> : <div aria-busy={query.isFetching} className="space-y-4">
      <DataGrid aria-label="用户列表" data={users} columns={columns} getRowId={user => user.id} selectionMode="none" variant="secondary" contentClassName="min-w-[760px]" scrollContainerClassName="max-h-[65vh] overflow-auto" stickyHeader renderEmptyState={() => <Empty title="没有匹配的用户" description="试试其他昵称、邮箱或账户类型。" />} />
      <nav aria-label="用户列表分页" className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm tabular-nums text-muted">{total ? `${count(filters.offset + 1)}–${count(filters.offset + users.length)} / ${count(total)} 位用户` : '暂无用户'} · 每页 {pageSize} 位</p>
        <div className="flex gap-2"><Button variant="secondary" isDisabled={filters.offset === 0 || query.isFetching} onPress={() => setFilters(current => ({ ...current, offset: Math.max(0, current.offset - pageSize) }))}>上一页</Button><Button variant="secondary" isDisabled={!query.data?.hasMore || query.isFetching} onPress={() => setFilters(current => ({ ...current, offset: current.offset + pageSize }))}>下一页</Button></div>
      </nav>
    </div>}
  </div>
}
