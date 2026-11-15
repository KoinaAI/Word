import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, Chip } from '@heroui/react'
import { ArrowRight, BookOpen, Thunderbolt, ArrowsRotateRight, Check, Flame, Clock, ChartColumn, Bookmark } from '@gravity-ui/icons'
import { api, useUser } from '@/lib/api'
import type { Book, Stats, Word } from '@/lib/types'
import { ActivityChart, BookCard, BookCover, Failure, Loading, PageHeading, Progress, Stat } from '@/components/shared'
import './home-library.css'

export function HomePage() {
  const navigate = useNavigate()
  const { data: user } = useUser()
  const books = useQuery({ queryKey: ['books'], queryFn: () => api<Book[]>('/books') })
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api<Stats>('/stats') })
  const selectedBook = books.data?.find(item => item.id === user?.activeBookId) || books.data?.[0]
  const current = useQuery({
    queryKey: ['books', String(selectedBook?.id)],
    queryFn: () => api<{ book: Book; words: Word[] }>(`/books/${selectedBook!.id}`),
    enabled: Boolean(selectedBook),
  })
  if (books.isPending || stats.isPending) return <Loading />
  if (books.error || stats.error) return <Failure error={books.error || stats.error} retry={() => { void books.refetch(); void stats.refetch() }} />
  const book = current.data?.book || selectedBook
  const summary = stats.data
  const hour = new Date().getHours()
  const greeting = hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好'
  const target = user?.dailyGoal || 20
  const newCount = current.data?.words.filter(word => word.status === 'new').length
  const reinforceCount = current.data?.words.filter(word => word.reinforce).length || 0
  const allMastered = Boolean(book && book.wordCount > 0 && book.learnedCount === book.wordCount)
  const reviewBook = book?.dueCount ? book : books.data.find(item => item.dueCount > 0)
  const hasReview = Boolean(reviewBook) || summary.due > 0
  const reviewCount = reviewBook?.dueCount || summary.due
  const newRoundCount = Math.min(newCount || 0, target)
  const nextAction = hasReview
    ? { title: `先复习 ${reviewCount} 个到期词`, description: reviewBook ? `来自《${reviewBook.title}》。先把已经学过的词记牢，再开始新的一组。` : '有单词需要回顾，选择一本词书开始复习。', label: '开始复习', route: reviewBook ? `/study/${reviewBook.id}/review` : '/review' }
    : newRoundCount > 0 && book
      ? { title: `学一组新词，今天从 ${newRoundCount} 个开始`, description: `《${book.title}》还有 ${newCount} 个未学词。用英译中、中译英练习，一步步记牢。`, label: '开始学新词', route: `/study/${book.id}/learn` }
      : reinforceCount > 0 && book
        ? { title: `再巩固 ${reinforceCount} 个模糊的词`, description: '这些词曾在速刷中犹豫过，现在可以再回想一次。', label: '开始巩固', route: `/study/${book.id}/reinforce` }
        : { title: allMastered ? '这本词书，已经全部掌握' : book ? '按自己的节奏，稳稳往前走' : '选一本词书，开始今天的学习', description: allMastered ? '暂时没有到期复习。可以查看掌握进度，或开始下一本词书。' : book ? current.isPending ? '正在读取当前词书的学习进度…' : current.error ? '暂时无法读取新词进度，可以进入词书查看。' : '当前没有未学词。已学过的词会按计划安排复习。' : '找到适合你的目标，从一小组单词开始。', label: book ? '查看当前词书' : '选择词书', route: book ? `/books/${book.id}` : '/books' }
  const examDays = user?.examDate ? Math.ceil((new Date(`${user.examDate.slice(0,10)}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000) : null
  return <div className="page-stack home-page"><PageHeading eyebrow="今日学习" title={`${greeting}，开始今天的一小步`} description="先复习到期词，再学一组新词。" action={<Button variant="outline" onPress={() => navigate('/settings')}><Clock />{examDays !== null && examDays >= 0 ? `距离考试 ${examDays} 天` : '学习计划'}</Button>} />
    <section className="home-focus-grid" aria-label="今日学习任务">
      <Card className="today-task"><Card.Header><Chip color="success" variant="soft" className="w-fit">{hasReview ? '优先复习' : newRoundCount > 0 ? '学新词' : '下一步'}</Chip><Card.Title>{nextAction.title}</Card.Title><Card.Description>{nextAction.description}</Card.Description></Card.Header><Card.Content><div className="round-plan"><BookOpen /><span>每轮新词数量 <strong>最多 {target} 词</strong></span><Button size="sm" variant="ghost" onPress={() => navigate('/settings')}>调整</Button></div></Card.Content><Card.Footer><Button isPending={!hasReview && Boolean(book) && current.isPending} onPress={() => navigate(nextAction.route)}>{nextAction.label}<ArrowRight /></Button>{hasReview && newRoundCount > 0 && book ? <Button variant="ghost" onPress={() => navigate(`/study/${book.id}/learn`)}>学新词</Button> : book && <Button variant="ghost" onPress={() => navigate('/books')}>换本词书</Button>}</Card.Footer></Card>
      <Card className="home-current-book"><Card.Header className="section-card-header"><Card.Title>当前词书</Card.Title><Button size="sm" variant="ghost" onPress={() => navigate(book ? `/books/${book.id}` : '/books')}>{book ? '查看词书' : '选择词书'}<ArrowRight /></Button></Card.Header><Card.Content>{book ? <><div className="home-book-summary"><BookCover book={book} small /><div><Chip size="sm" color="success" variant="soft">{allMastered ? '已全部掌握' : '在学'}</Chip><h3>{book.title}</h3><p>{book.subtitle}</p><span>{book.wordCount} 词{book.dueCount > 0 && ` · ${book.dueCount} 词待复习`}</span></div></div><div className="learning-progress-copy"><span>已掌握 {book.learnedCount} / {book.wordCount} 词</span><strong>{book.wordCount ? Math.round(book.learnedCount / book.wordCount * 100) : 0}%</strong></div><Progress label="当前词书掌握进度" value={book.wordCount ? book.learnedCount / book.wordCount * 100 : 0} /></> : <p className="library-muted">选好词书后，这里会显示你的学习进度。</p>}</Card.Content></Card>
    </section>
    <section className="stats-grid" aria-label="学习数据"><Stat title="今日已练习" value={summary.today} foot="词 · 各模式合并去重（UTC）" icon={<Check />} /><Stat title="累计掌握" value={summary.learned} foot="词 · 已掌握的词汇" icon={<BookOpen />} /><Stat title="待复习" value={summary.due} foot={summary.due > 0 ? '词 · 已到复习时间' : '词 · 暂时没有到期复习'} icon={<ArrowsRotateRight />} /><Stat title="连续学习" value={summary.streak} foot="天 · 保持自己的节奏" icon={<Flame />} /></section>
    <section className="home-practice-grid"><Card className="activity-card"><Card.Header className="section-card-header"><div><Card.Title>最近的学习节奏</Card.Title><Card.Description>最近 14 天 · 学习与复习次数 · UTC</Card.Description></div><Button size="sm" variant="ghost" onPress={() => navigate('/statistics')}>全部记录<ArrowRight /></Button></Card.Header><Card.Content><ActivityChart activity={summary.activity.slice(-14)} /></Card.Content></Card><Card className="home-sprint-card"><Card.Header><span className="home-sprint-icon"><Thunderbolt /></span><Card.Title>考前，快速过一遍</Card.Title><Card.Description>会的直接跳过，不确定的看释义后再决定，集中巩固模糊的词。</Card.Description></Card.Header><Card.Footer><Button variant="outline" onPress={() => navigate('/sprint')}>进入临考速刷<ArrowRight /></Button></Card.Footer></Card></section>
    {books.data.some(item => item.id !== book?.id) && <section><div className="section-heading"><div><h2>下一本，学什么</h2><p>根据考试或学习目标，找到适合自己的词书。</p></div><Button variant="ghost" size="sm" onPress={() => navigate('/books')}>全部词书 <ArrowRight /></Button></div><div className="book-grid-home">{books.data.filter(item => item.id !== book?.id).slice(0, 3).map(item => <BookCard key={item.id} book={item} onOpen={() => navigate(`/books/${item.id}`)} />)}</div></section>}
  </div>
}

export function StatisticsPage() {
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api<Stats>('/stats') })
  if (stats.isPending) return <Loading />
  if (stats.error) return <Failure error={stats.error} retry={stats.refetch} />
  const s = stats.data
  return <div className="page-stack"><PageHeading eyebrow="积累，比速度更重要" title="看见你的每一步" description="每一次学习都被认真记录。统计按 UTC 日期汇总。" /><div className="stats-grid"><Stat title="累计掌握" value={s.learned} foot={`词库共 ${s.totalWords} 词`} icon={<BookOpen />} /><Stat title="连续学习" value={s.streak} foot="天 · 保持自己的节奏" icon={<Flame />} /><Stat title="巩固列表" value={s.reinforce} foot="回想起来的词，也值得再见" icon={<ArrowsRotateRight />} /><Stat title="收藏词汇" value={s.favorites} foot="你的个人词汇收藏" icon={<Bookmark />} /></div><Card><Card.Header><Card.Title>学习活动</Card.Title><Card.Description>每日完成的学习与复习次数</Card.Description></Card.Header><Card.Content><ActivityChart activity={s.activity} /></Card.Content></Card><Card><Card.Header><Card.Title>最近学习</Card.Title></Card.Header><Card.Content>{s.recent.length ? <div className="recent-list">{s.recent.map((word, index) => <div className="recent-row" key={`${word.id}-${index}`}><div><strong>{word.text}</strong><span>{word.meaning}</span></div><Chip size="sm" variant="soft" color={word.answer.includes('unknown') ? 'default' : 'success'}>{word.answer === 'unsure-known' ? '待巩固' : word.answer.includes('unknown') ? '继续学习' : '已记住'}</Chip><time>{new Date(word.createdAt).toLocaleDateString('zh-CN')}</time></div>)}</div> : <div className="text-center py-10 text-muted"><ChartColumn className="mx-auto mb-3" />开始一次学习，这里就会留下你的足迹。</div>}</Card.Content></Card></div>
}
