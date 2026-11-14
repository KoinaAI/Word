import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { Button } from '@heroui/react'
import { useUser } from './lib/api'
import { Layout } from './components/layout'
import { Empty, ErrorState, Loading } from './components/shared'
import { Home } from './pages/home'
import { BookDetail, Books, Favorites } from './pages/books'
import { Study } from './pages/study'
import { Review, Statistics } from './pages/progress'
import { Login, Settings } from './pages/account'

function Session(){const user=useUser();const location=useLocation();if(location.pathname==='/login')return <Outlet/>;if(user.error)return <ErrorState error={user.error} retry={()=>void user.refetch()}/>;if(!user.data)return <div className="session-loading"><Loading/></div>;return <Outlet/>}
function AdminPlaceholder(){const {data:user}=useUser();if(user?.role!=='admin')return <Navigate to="/login" replace/>;return <Empty title="管理工作台" description="词书、学习数据和导航配置。"/>}
export default function App(){return <Routes><Route element={<Session/>}><Route path="/login" element={<Login/>}/><Route path="/study/:id" element={<Study/>}/><Route element={<Layout/>}><Route index element={<Home/>}/><Route path="books" element={<Books/>}/><Route path="books/:id" element={<BookDetail/>}/><Route path="sprint" element={<Books sprint/>}/><Route path="review" element={<Review/>}/><Route path="favorites" element={<Favorites/>}/><Route path="stats" element={<Statistics/>}/><Route path="settings" element={<Settings/>}/><Route path="admin/*" element={<AdminPlaceholder/>}/><Route path="*" element={<Empty title="页面走丢了" description="回到学习空间，继续你的下一步。"><Button onPress={()=>window.location.assign('/')}>返回首页</Button></Empty>}/></Route></Route></Routes>}
