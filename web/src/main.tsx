import { lazy, Suspense, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { Toaster } from 'sonner'
import { Button } from '@heroui/react'
import { Layout } from '@/components/layout'
import { Empty, Loading } from '@/components/shared'
import { HomePage, StatisticsPage } from '@/pages/home'
import { BookDetailPage, BooksPage, FavoritesPage, ModePicker } from '@/pages/books'
import { LoginPage, SettingsPage } from '@/pages/settings'
import './styles.css'

const AdminPage = lazy(() => import('@/pages/admin').then(module => ({ default: module.AdminPage })))
const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } })
function MissingPage() { const navigate = useNavigate(); return <Empty title="这一页还没有单词" description="页面可能已移动，回到学习空间继续探索。" action={<Button onPress={() => navigate('/')}>返回首页</Button>} /> }
function App() {
  return <Routes><Route path="/login" element={<LoginPage />} /><Route element={<Layout />}><Route index element={<HomePage />} /><Route path="books" element={<BooksPage />} /><Route path="books/:bookId" element={<BookDetailPage />} /><Route path="sprint" element={<ModePicker mode="sprint" />} /><Route path="review" element={<ModePicker mode="review" />} /><Route path="favorites" element={<FavoritesPage />} /><Route path="statistics" element={<StatisticsPage />} /><Route path="settings" element={<SettingsPage />} /><Route path="admin/*" element={<Suspense fallback={<Loading />}><AdminPage /></Suspense>} /><Route path="*" element={<MissingPage />} /></Route></Routes>
}
createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={client}><BrowserRouter><MotionConfig reducedMotion="user"><App /><Toaster richColors position="top-center" closeButton /></MotionConfig></BrowserRouter></QueryClientProvider></StrictMode>)
