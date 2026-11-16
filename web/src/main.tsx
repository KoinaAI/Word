import { lazy, Suspense, StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { Toaster } from 'sonner'
import { Button } from '@heroui/react'
import { Layout } from '@/components/layout'
import { Empty, Failure, Loading } from '@/components/shared'
import { RouteBoundary } from '@/components/route-boundary'
import { reconnectSession, useSessionBoundary } from '@/lib/api'
import { stopPronunciation } from '@/lib/speech'
import './styles.css'

const HomePage = lazy(() => import('@/pages/home').then(module => ({ default: module.HomePage })))
const StatisticsPage = lazy(() => import('@/pages/home').then(module => ({ default: module.StatisticsPage })))
const BooksPage = lazy(() => import('@/pages/books').then(module => ({ default: module.BooksPage })))
const BookDetailPage = lazy(() => import('@/pages/books').then(module => ({ default: module.BookDetailPage })))
const FavoritesPage = lazy(() => import('@/pages/books').then(module => ({ default: module.FavoritesPage })))
const ModePicker = lazy(() => import('@/pages/books').then(module => ({ default: module.ModePicker })))
const LoginPage = lazy(() => import('@/pages/settings').then(module => ({ default: module.LoginPage })))
const SettingsPage = lazy(() => import('@/pages/settings').then(module => ({ default: module.SettingsPage })))
const StudyPage = lazy(() => import('@/pages/study').then(module => ({ default: module.StudyPage })))
const AdminPage = lazy(() => import('@/pages/admin').then(module => ({ default: module.AdminPage })))
const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true } } })
function MissingPage() { const navigate = useNavigate(); return <Empty title="这一页还没有单词" description="页面可能已移动，回到学习空间继续探索。" action={<Button onPress={() => navigate('/')}>返回首页</Button>} /> }
function ReconnectSession() {
  const client = useQueryClient()
  const [error, setError] = useState<Error | null>(null)
  const retry = () => { setError(null); void reconnectSession(client).catch(value => setError(value instanceof Error ? value : new Error('账号暂时无法连接'))) }
  useEffect(retry, [client])
  return error ? <Failure error={error} retry={retry} /> : <Loading label="账号已变更，正在重新连接" />
}
function App() {
  const { pathname } = useLocation()
  const session = useSessionBoundary()
  useEffect(() => stopPronunciation, [pathname, session.epoch])
  if (session.checking) return <ReconnectSession key={session.epoch} />
  return <RouteBoundary key={`${session.epoch}:${pathname}`}><Suspense fallback={<Loading />}><Routes><Route path="/login" element={<LoginPage />} /><Route path="/study/:bookId/:mode" element={<StudyPage />} /><Route element={<Layout />}><Route index element={<HomePage />} /><Route path="books" element={<BooksPage />} /><Route path="books/:bookId" element={<BookDetailPage />} /><Route path="sprint" element={<ModePicker mode="sprint" />} /><Route path="review" element={<ModePicker mode="review" />} /><Route path="favorites" element={<FavoritesPage />} /><Route path="statistics" element={<StatisticsPage />} /><Route path="settings" element={<SettingsPage />} /><Route path="admin/*" element={<AdminPage />} /><Route path="*" element={<MissingPage />} /></Route></Routes></Suspense></RouteBoundary>
}
createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={client}><BrowserRouter><MotionConfig reducedMotion="user"><App /><Toaster richColors position="top-center" closeButton /></MotionConfig></BrowserRouter></QueryClientProvider></StrictMode>)
