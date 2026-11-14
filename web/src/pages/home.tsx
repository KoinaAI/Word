import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, Chip } from '@heroui/react'
import { ArrowRight, BookOpen, Thunderbolt, ArrowsRotateRight, Check, Flame, Clock, ChartColumn, Bookmark } from '@gravity-ui/icons'
import { api, useUser } from '@/lib/api'
import type { Book, Stats } from '@/lib/types'
import { ActivityChart, BookCard, BookCover, Failure, Loading, PageHeading, Progress, Stat } from '@/components/shared'

export function HomePage() {
  const navigate = useNavigate()
  const { data: user } = useUser()
  const books = useQuery({ queryKey: ['books'], queryFn: () => api<Book[]>('/books') })
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api<Stats>('/stats') })
  if (books.isPending || stats.isPending) return <Loading />
  if (books.error || stats.error) return <Failure error={books.error || stats.error} retry={() => { void books.refetch(); void stats.refetch() }} />
  const book = books.data.find(item => item.id === user?.activeBookId) || books.data[0]
  const summary = stats.data
  const hour = new Date().getHours()
  const greeting = hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好'
  const target = user?.dailyGoal || 20
  return <div className="page-stack"><PageHeading eyebrow="每一天，都离目标更近一点" title={`${greeting}，今天也一起进步。`} description="把大目标拆成小小的每一天，让记住变得自然而然。" action={<Button variant="outline" onPress={() => navigate('/settings')}><CalendarIcon />我的学习计划</Button>} />
    <section className="hero-grid"><Card className="daily-hero"><div className="hero-copy"><Chip color="success" variant="soft" className="w-fit"><span className="status-dot" /> 今日学习</Chip><h2>让每一个单词，<br />成为你的<span>底气。</span></h2><p>不必一口气走很远。今天，先记住 {target} 个新可能。</p><div className="hero-actions"><Button onPress={() => navigate(book ? `/study/${book.id}/learn` : '/books')}>开始今日学习 <ArrowRight /></Button><span>{summary.today >= target ? '今日目标已完成，继续保持' : `今日已学习 ${summary.today} / ${target} 词`}</span></div></div><div className="hero-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="art-dots" /><div className="flashcard flashcard-back"><span>little by little</span></div><div className="flashcard flashcard-front"><span className="flashcard-label">One word at a time.</span><strong>possibility</strong><span className="flashcard-phonetic">/ˌpɒsəˈbɪləti/</span><div className="flashcard-line" /><p>n. 可能性；机会</p><span className="flashcard-check"><Check /></span></div><span className="art-spark art-spark-one">✦</span><span className="art-spark art-spark-two">✦</span></div></Card>
      <Card className="sprint-promo"><div className="promo-icon"><Thunderbolt /></div><div><p className="eyebrow">考前，把时间用在刀刃上</p><h2>临考速刷</h2><p>会的轻松跳过，模糊的重点巩固。<br />只为还没掌握的单词停留。</p></div><Button variant="outline" onPress={() => navigate('/sprint')}>进入速刷 <ArrowRight /></Button><span className="sprint-decoration" aria-hidden="true">↗</span></Card></section>
    <section className="stats-grid"><Stat title="累计掌握" value={summary.learned} foot="每个单词，都是一份积累" icon={<BookOpen />} /><Stat title="待复习单词" value={summary.due} foot={summary.due > 0 ? '趁记忆还在，及时唤醒' : '没有到期复习，轻松前进'} icon={<ArrowsRotateRight />} /><Stat title="连续学习" value={summary.streak} foot="天 · 小习惯带来大改变" icon={<Flame />} /><Stat title="今日已学习" value={summary.today} foot={`每日目标 ${target} 词`} icon={<Check />} /></section>
    <section className="dashboard-middle"><Card className="current-book"><Card.Header className="section-card-header"><Card.Title>正在学习</Card.Title><Button size="sm" variant="ghost" onPress={() => navigate('/books')}>切换词书 <ArrowRight /></Button></Card.Header><Card.Content>{book ? <div className="current-book-body"><BookCover book={book} small /><div className="current-book-info"><Chip size="sm" variant="soft">{book.category}</Chip><h3>{book.title}</h3><p>{book.subtitle}</p><div className="progress-copy"><span>已掌握 {book.learnedCount} 词</span><span>{book.wordCount > 0 ? Math.round(book.learnedCount / book.wordCount * 100) : 0}%</span></div><Progress label="词书掌握进度" value={book.wordCount ? book.learnedCount / book.wordCount * 100 : 0} /><div className="flex gap-3 mt-5"><Button size="sm" onPress={() => navigate(`/study/${book.id}/learn`)}>继续学习 <ArrowRight /></Button><Button size="sm" variant="ghost" onPress={() => navigate(`/books/${book.id}`)}>查看词书</Button></div></div></div> : <p className="text-muted py-8">词书正在准备中，请稍后再来。</p>}</Card.Content></Card><Card className="activity-card"><Card.Header className="section-card-header"><Card.Title>学习的每一步</Card.Title><span className="text-xs text-muted">最近 14 天 · UTC</span></Card.Header><Card.Content><ActivityChart activity={summary.activity.slice(-14)} /></Card.Content></Card></section>
    <section><div className="section-heading"><div><h2>遇见你的下一本词书</h2><p>从一个小目标开始，慢慢拓宽你的世界。</p></div><Button variant="ghost" size="sm" onPress={() => navigate('/books')}>全部词书 <ArrowRight /></Button></div><div className="book-grid-home">{books.data.filter(item => item.id !== book?.id).slice(0, 4).map(item => <BookCard key={item.id} book={item} onOpen={() => navigate(`/books/${item.id}`)} />)}</div></section>
    <footer className="page-footer"><Bookmark /><span>记忆会遗忘，努力会留下。今天的你，又向前了一点。</span></footer>
  </div>
}
function CalendarIcon() { return <Clock /> }

export function StatisticsPage() {
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api<Stats>('/stats') })
  if (stats.isPending) return <Loading />
  if (stats.error) return <Failure error={stats.error} retry={stats.refetch} />
  const s = stats.data
  return <div className="page-stack"><PageHeading eyebrow="积累，比速度更重要" title="看见你的每一步" description="每一次学习都被认真记录。统计按 UTC 日期汇总。" /><div className="stats-grid"><Stat title="累计掌握" value={s.learned} foot={`词库共 ${s.totalWords} 词`} icon={<BookOpen />} /><Stat title="连续学习" value={s.streak} foot="天 · 保持自己的节奏" icon={<Flame />} /><Stat title="巩固列表" value={s.reinforce} foot="回想起来的词，也值得再见" icon={<ArrowsRotateRight />} /><Stat title="收藏词汇" value={s.favorites} foot="你的个人词汇收藏" icon={<Bookmark />} /></div><Card><Card.Header><Card.Title>学习活动</Card.Title><Card.Description>每日完成的学习与复习次数</Card.Description></Card.Header><Card.Content><ActivityChart activity={s.activity} /></Card.Content></Card><Card><Card.Header><Card.Title>最近学习</Card.Title></Card.Header><Card.Content>{s.recent.length ? <div className="recent-list">{s.recent.map((word, index) => <div className="recent-row" key={`${word.id}-${index}`}><div><strong>{word.text}</strong><span>{word.meaning}</span></div><Chip size="sm" variant="soft" color={word.answer.includes('unknown') ? 'default' : 'success'}>{word.answer === 'unsure-known' ? '待巩固' : word.answer.includes('unknown') ? '继续学习' : '已记住'}</Chip><time>{new Date(word.createdAt).toLocaleDateString('zh-CN')}</time></div>)}</div> : <div className="text-center py-10 text-muted"><ChartColumn className="mx-auto mb-3" />开始一次学习，这里就会留下你的足迹。</div>}</Card.Content></Card></div>
}
