import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Chip, Dropdown, Label } from '@heroui/react'
import { AppLayout, Sidebar } from '@heroui-pro/react'
import { BookOpen, House, Thunderbolt, ArrowsRotateRight, Star, ChartColumn, Gear, Magnifier, ArrowRight, ArrowLeft, Person, Persons, Layers, ChevronDown, Calendar } from '@gravity-ui/icons'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from './ui/command'
import { api, json, useUser } from '@/lib/api'
import type { Book, Navigation, Stats } from '@/lib/types'
import { Failure, Loading } from './shared'
import { toast } from 'sonner'

const menu = [
  { path: '/', label: '学习概览', icon: House },
  { path: '/books', label: '发现词书', icon: BookOpen },
  { path: '/sprint', label: '临考速刷', icon: Thunderbolt },
  { path: '/review', label: '记忆复习', icon: ArrowsRotateRight },
  { path: '/favorites', label: '收藏单词', icon: Star },
  { path: '/statistics', label: '学习统计', icon: ChartColumn },
]
const adminIcons: Record<string, typeof House> = { 'chart-column': ChartColumn, 'book-open': BookOpen, persons: Persons, sliders: Layers }

export function Layout() {
  const { data: user, error, isPending, refetch } = useUser()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const client = useQueryClient()
  const [searchOpen, setSearchOpen] = useState(false)
  const admin = pathname.startsWith('/admin')
  const nav = useQuery({ queryKey: ['admin', 'navigation'], queryFn: () => api<Navigation[]>('/admin/navigation'), enabled: user?.role === 'admin' })
  const books = useQuery({ queryKey: ['books'], queryFn: () => api<Book[]>('/books'), enabled: !!user })
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api<Stats>('/stats'), enabled: !!user })
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(open => !open) } }
    document.addEventListener('keydown', shortcut)
    return () => document.removeEventListener('keydown', shortcut)
  }, [])
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  if (isPending) return <Loading />
  if (error || !user) return <Failure error={error} retry={refetch} />
  const title = admin ? (nav.data?.find(item => item.path === pathname)?.label || '词书管理') : (menu.find(item => item.path === pathname)?.label || (pathname.startsWith('/books/') ? '词书详情' : '学习设置'))
  const active = books.data?.find(book => book.id === user.activeBookId)
  const go = (path: string) => { setSearchOpen(false); navigate(path) }
  const logout = async () => {
    try { await api('/auth/logout', json('POST')); client.clear(); navigate('/login'); toast.success('已安全退出') }
    catch (e) { toast.error((e as Error).message) }
  }
  const sidebar = <>
    <Sidebar.Header className="brand-area"><a href="/" onClick={event => { event.preventDefault(); navigate('/') }} className="brand"><img src="/favicon.svg" alt="" /><span>就背单词<small>Little by little, a little becomes a lot.</small></span></a></Sidebar.Header>
    <Sidebar.Content className="px-4">
      <Sidebar.Group><Sidebar.GroupLabel>{admin ? '管理工作台' : '我的学习空间'}</Sidebar.GroupLabel><Sidebar.Menu aria-label={admin ? '管理导航' : '学习导航'}>{(admin ? (nav.data || []).filter(item => item.enabled).sort((a,b) => a.sortOrder - b.sortOrder).map(item => ({...item, icon: adminIcons[item.icon] || Layers})) : menu).map(item => <Sidebar.MenuItem key={item.path} id={item.path} href={item.path} isCurrent={pathname === item.path || (item.path !== '/' && pathname.startsWith(`${item.path}/`))} textValue={item.label}><Sidebar.MenuIcon><item.icon /></Sidebar.MenuIcon><Sidebar.MenuLabel>{item.label}</Sidebar.MenuLabel>{item.path === '/sprint' && <Sidebar.MenuChip><span className="nav-tag">专注</span></Sidebar.MenuChip>}{item.path === '/review' && (stats.data?.due || 0) > 0 && <Sidebar.MenuChip>{stats.data?.due}</Sidebar.MenuChip>}</Sidebar.MenuItem>)}</Sidebar.Menu></Sidebar.Group>
      {!admin && <div className="sidebar-note"><span className="sidebar-note-label"><Calendar /> 每日小目标</span><p>一点点积累，<br />也是了不起的前进。</p><Button variant="ghost" size="sm" onPress={() => navigate('/settings')}>设置学习计划 <ArrowRight /></Button></div>}
    </Sidebar.Content>
    <Sidebar.Footer className="px-4 pb-5"><Sidebar.Menu aria-label="其他功能"><Sidebar.MenuItem id="settings" textValue="学习设置" href="/settings" isCurrent={pathname === '/settings'}><Sidebar.MenuIcon><Gear /></Sidebar.MenuIcon><Sidebar.MenuLabel>学习设置</Sidebar.MenuLabel></Sidebar.MenuItem>{user.role === 'admin' && <Sidebar.MenuItem id="switch" textValue={admin ? '返回学习空间' : '管理后台'} href={admin ? '/' : '/admin'}><Sidebar.MenuIcon>{admin ? <ArrowLeft /> : <Layers />}</Sidebar.MenuIcon><Sidebar.MenuLabel>{admin ? '返回学习空间' : '管理后台'}</Sidebar.MenuLabel></Sidebar.MenuItem>}</Sidebar.Menu>
      <Dropdown><Button variant="ghost" className="profile-trigger"><span className="profile-avatar">{user.name.slice(0,1)}</span><span className="profile-text"><strong>{user.name}</strong><small>{user.guest ? '访客学习者 · 注册可保留进度' : user.email}</small></span><ChevronDown className="size-4 text-muted" /></Button><Dropdown.Popover placement="top start"><Dropdown.Menu aria-label="账号操作" onAction={key => { if (key === 'logout') void logout(); else navigate(String(key)) }}><Dropdown.Item id="/settings" textValue="学习设置"><Label>学习设置</Label></Dropdown.Item><Dropdown.Item id="/login" textValue={user.guest ? '登录 / 注册' : '切换账号'}><Label>{user.guest ? '登录 / 注册' : '切换账号'}</Label></Dropdown.Item>{!user.guest && <Dropdown.Item id="logout" textValue="退出登录" variant="danger"><Label>退出登录</Label></Dropdown.Item>}</Dropdown.Menu></Dropdown.Popover></Dropdown>
    </Sidebar.Footer>
  </>
  return <><AppLayout className="word-layout" navigate={navigate} sidebarCollapsible="offcanvas" sidebar={<><Sidebar>{sidebar}</Sidebar><Sidebar.Mobile>{sidebar}</Sidebar.Mobile></>} navbar={<div className="app-topbar"><div className="flex items-center gap-3"><AppLayout.MenuToggle aria-label="切换导航" tooltip="切换导航" /><span className="breadcrumb-root">{admin ? '管理后台' : '学习空间'}</span><span className="text-muted/40">/</span><span className="text-sm">{title}</span></div><div className="flex items-center gap-4"><Button variant="ghost" size="sm" onPress={() => setSearchOpen(true)} aria-label="快速导航"><Magnifier /><span className="hidden sm:inline">快速查找</span><kbd className="hidden sm:inline">⌘ K</kbd></Button><span className="topbar-status"><i />学习记录自动保存</span></div></div>}><div className="page-wrap"><Outlet /></div></AppLayout>
    <CommandDialog open={searchOpen} onOpenChange={setSearchOpen} title="快速导航" description="搜索页面或词书，回车打开。"><CommandInput placeholder="搜索词书或功能…" /><CommandList><CommandEmpty>没有找到匹配的内容</CommandEmpty><CommandGroup heading="学习空间">{menu.map(item => <CommandItem key={item.path} value={item.label} onSelect={() => go(item.path)}><item.icon />{item.label}{item.path === '/' && <CommandShortcut>首页</CommandShortcut>}</CommandItem>)}</CommandGroup>{books.data && <CommandGroup heading="我的词书">{books.data.map(book => <CommandItem key={book.id} value={book.title} onSelect={() => go(`/books/${book.id}`)}><BookOpen />{book.title}{active?.id === book.id && <Chip size="sm" variant="soft" color="success">在学</Chip>}</CommandItem>)}</CommandGroup>}<CommandGroup heading="账号"><CommandItem onSelect={() => go('/settings')}><Person />学习设置</CommandItem></CommandGroup></CommandList></CommandDialog>
  </>
}
