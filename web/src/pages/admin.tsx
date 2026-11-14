import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@heroui/react'
import { Empty, Failure, Loading } from '@/components/shared'
import { api, useUser } from '@/lib/api'
import type { Navigation } from '@/lib/types'
import { AdminBookDetail, AdminBooks } from './admin-books'
import { AdminOverview, AdminUsers } from './admin-insights'
import { AdminNavigation } from './admin-navigation'

/** Resolves server-enabled navigation against compiled modules only. */
export function AdminPage() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { data: user } = useUser()
  const query = useQuery({ enabled: user?.role === 'admin', queryKey: ['admin', 'navigation'], queryFn: () => api<Navigation[]>('/admin/navigation') })
  if (user && user.role !== 'admin') return <Empty title="管理员工作台" description="请使用部署时设置的管理员账号登录，管理词书和站点数据。" action={<Button onPress={() => navigate('/login')}>管理员登录</Button>} />
  if (query.isPending) return <Loading label="正在加载管理工作台" />
  if (query.isError) return <Failure error={query.error} retry={query.refetch} />
  const path = pathname.replace(/\/$/, '')
  const detail = /^\/admin\/books\/(\d+)$/.exec(path)
  const modulePath = detail ? '/admin/books' : path
  const module = query.data.find(item => item.path === modulePath)
  if (!module || !module.enabled) return <Empty title={module ? '这个模块已停用' : '没有找到这个页面'} description="可以在导航配置中查看并启用后台模块。" action={<Button variant="secondary" onPress={() => navigate('/admin/navigation')}>导航配置</Button>} />
  if (detail) return <AdminBookDetail key={detail[1]} id={Number(detail[1])} />
  switch (modulePath) {
    case '/admin': return <AdminOverview />
    case '/admin/books': return <AdminBooks />
    case '/admin/users': return <AdminUsers />
    case '/admin/navigation': return <AdminNavigation />
    default: return <Empty title="没有找到这个模块" description="请从管理导航选择一个可用页面。" />
  }
}
