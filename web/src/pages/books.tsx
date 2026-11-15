import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Chip, Input } from '@heroui/react'
import { Segment } from '@heroui-pro/react/segment'
import { ListView } from '@heroui-pro/react/list-view'
import { ArrowRight, Thunderbolt, BookOpen, ArrowsRotateRight, Star, Volume, ArrowLeft, Magnifier } from '@gravity-ui/icons'
import { toast } from 'sonner'
import { api, json, useRefresh, useUser } from '@/lib/api'
import { pronounce } from '@/lib/speech'
import type { Book, User, Word } from '@/lib/types'
import { BookCard, BookCover, Empty, Failure, IconButton, Loading, PageHeading, Progress } from '@/components/shared'
import './home-library.css'

type BookDetail = { book: Book; words: Word[] }
type WordFilter = 'all' | 'new' | 'learning' | 'mastered' | 'reinforce'
const wordFilters: { id: WordFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'new', label: '未学' },
  { id: 'learning', label: '学习中' },
  { id: 'mastered', label: '已掌握' },
  { id: 'reinforce', label: '待巩固' },
]

export function BooksPage() {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('全部')
  const navigate = useNavigate()
  const { data: user } = useUser()
  const books = useQuery({ queryKey: ['books'], queryFn: () => api<Book[]>('/books') })
  const activeBook = books.data?.find(book => book.id === user?.activeBookId)
  const current = useQuery({ queryKey: ['books', String(activeBook?.id)], queryFn: () => api<BookDetail>(`/books/${activeBook!.id}`), enabled: Boolean(activeBook) })
  if (books.isPending) return <Loading />
  if (books.error) return <Failure error={books.error} retry={books.refetch} />
  const currentBook = current.data?.book || activeBook
  const currentNewCount = current.data?.words.filter(word => word.status === 'new').length || 0
  const currentReinforceCount = current.data?.words.filter(word => word.reinforce).length || 0
  const currentAction = currentBook?.dueCount ? { label: '继续复习', route: `/study/${currentBook.id}/review` } : currentNewCount > 0 ? { label: '继续学新词', route: `/study/${currentBook?.id}/learn` } : currentReinforceCount > 0 ? { label: '继续巩固', route: `/study/${currentBook?.id}/reinforce` } : { label: '查看词书', route: `/books/${currentBook?.id}` }
  const categories = ['全部', ...new Set(books.data.map(book => book.category))]
  const filtered = books.data.filter(book => (category === '全部' || book.category === category) && `${book.title}${book.subtitle}${book.description}`.toLowerCase().includes(search.trim().toLowerCase()))
  const clearFilters = () => { setSearch(''); setCategory('全部') }
  return <div className="page-stack library-page"><PageHeading eyebrow="词书" title="选一本，学得更专注" description="按学习目标选择词书，也可以随时回到正在学的那一本。" />
    {currentBook && <Card className="library-current"><div className="library-current-summary"><BookCover book={currentBook} small /><div><span className="library-current-label">当前词书</span><h2>{currentBook.title}</h2><p>已掌握 {currentBook.learnedCount} / {currentBook.wordCount} 词{currentBook.dueCount > 0 ? ` · ${currentBook.dueCount} 词待复习` : currentNewCount > 0 ? ` · ${currentNewCount} 词未学` : ''}</p><Progress label="当前词书掌握进度" value={currentBook.wordCount ? currentBook.learnedCount / currentBook.wordCount * 100 : 0} /></div></div><Button variant="outline" isPending={current.isPending && !currentBook.dueCount} onPress={() => navigate(currentAction.route)}>{currentAction.label}<ArrowRight /></Button></Card>}
    <section className="library-catalog" aria-label="选择词书"><div className="filter-toolbar"><div className="library-filter-scroll"><Segment aria-label="词书分类" selectedKey={category} onSelectionChange={key => setCategory(String(key))} className="word-segment library-segment">{categories.map(item => <Segment.Item id={item} key={item}>{item}</Segment.Item>)}</Segment></div><div className="search-field"><Magnifier /><Input aria-label="搜索词书" placeholder="搜索词书…" value={search} onChange={event => setSearch(event.target.value)} /></div></div><div className="library-results"><span aria-live="polite">共 {filtered.length} 本词书</span>{(search || category !== '全部') && <Button size="sm" variant="ghost" onPress={clearFilters}>清除筛选</Button>}</div>{filtered.length ? <div className="book-library-grid">{filtered.map(book => <BookCard key={book.id} book={book} selected={user?.activeBookId === book.id} onOpen={() => navigate(`/books/${book.id}`)} />)}</div> : <Empty title="还没找到这本词书" description="试试其他关键词，或切换到全部分类。" action={<Button variant="secondary" onPress={clearFilters}>清除筛选</Button>} />}</section></div>
}

export function BookDetailPage() {
  const { bookId } = useParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const { data: user } = useUser()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<WordFilter>('all')
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const actionLock = useRef(false)
  const activeRequest = useRef<object | null>(null)
  useEffect(() => {
    setPendingAction(null)
    return () => { activeRequest.current = null; actionLock.current = false }
  }, [bookId])
  const detail = useQuery({ queryKey: ['books', bookId], queryFn: () => api<BookDetail>(`/books/${bookId}`) })
  if (detail.isPending) return <Loading />
  if (detail.error) return <Failure error={detail.error} retry={detail.refetch} />
  const { book, words } = detail.data
  const counts: Record<WordFilter, number> = { all: words.length, new: 0, learning: 0, mastered: 0, reinforce: 0 }
  for (const word of words) { counts[word.status]++; if (word.reinforce) counts.reinforce++ }
  const filteredWords = words.filter(word => (filter === 'all' || (filter === 'reinforce' ? word.reinforce : word.status === filter)) && `${word.text}${word.meaning}`.toLowerCase().includes(search.trim().toLowerCase()))
  const clearFilters = () => { setSearch(''); setFilter('all') }
  const chooseBook = async (mode?: 'learn' | 'review' | 'sprint' | 'reinforce') => {
    if (actionLock.current) return
    actionLock.current = true
    const request = {}
    activeRequest.current = request
    setPendingAction(mode || 'select')
    try {
      if (user?.activeBookId !== book.id) {
        const updated = await api<User>('/me', json('PATCH', { activeBookId: book.id }))
        client.setQueryData(['me'], updated)
      }
      if (activeRequest.current !== request) return
      if (mode) navigate(`/study/${book.id}/${mode}`)
      else toast.success('已设为当前词书')
    } catch (e) { if (activeRequest.current === request) toast.error((e as Error).message) }
    finally {
      if (activeRequest.current === request) { activeRequest.current = null; actionLock.current = false; setPendingAction(null) }
    }
  }
  return <div className="page-stack library-page book-detail-page"><Button variant="ghost" size="sm" className="self-start" onPress={() => navigate('/books')}><ArrowLeft />全部词书</Button>
    <section className="book-overview"><BookCover book={book} /><div className="book-overview-copy"><div className="book-overview-labels"><Chip variant="soft">{book.category}</Chip>{user?.activeBookId === book.id && <Chip color="success" variant="soft">当前词书</Chip>}</div><h1>{book.title}</h1><p>{book.description}</p><div className="book-overview-counts"><span><strong>{book.wordCount}</strong>个单词</span><span><strong>{book.learnedCount}</strong>已掌握</span><span><strong>{book.dueCount}</strong>到期复习</span></div><div className="learning-progress-copy"><span>掌握进度</span><strong>{book.wordCount ? Math.round(book.learnedCount / book.wordCount * 100) : 0}%</strong></div><Progress label="词书掌握进度" value={book.wordCount ? book.learnedCount / book.wordCount * 100 : 0} /><div className="book-learning-actions"><Button variant={book.dueCount > 0 ? 'outline' : 'primary'} isDisabled={counts.new === 0 || pendingAction !== null} isPending={pendingAction === 'learn'} onPress={() => { void chooseBook('learn') }}><BookOpen />{counts.new ? `学新词 · ${Math.min(counts.new, user?.dailyGoal || 20)} 词` : '新词已学完'}</Button><Button variant={book.dueCount > 0 ? 'primary' : 'outline'} isDisabled={book.dueCount === 0 || pendingAction !== null} isPending={pendingAction === 'review'} onPress={() => { void chooseBook('review') }}><ArrowsRotateRight />{book.dueCount ? `到期复习 · ${book.dueCount} 词` : '暂无到期复习'}</Button></div><div className="book-secondary-actions"><Button variant="ghost" isDisabled={pendingAction !== null || book.wordCount === 0} isPending={pendingAction === 'sprint'} onPress={() => { void chooseBook('sprint') }}><Thunderbolt />临考速刷</Button>{counts.reinforce > 0 && <Button variant="ghost" isDisabled={pendingAction !== null} isPending={pendingAction === 'reinforce'} onPress={() => { void chooseBook('reinforce') }}>巩固 {counts.reinforce} 词</Button>}{user?.activeBookId !== book.id && <Button variant="ghost" isDisabled={pendingAction !== null} isPending={pendingAction === 'select'} onPress={() => { void chooseBook() }}>设为当前词书</Button>}</div></div></section>
    <section className="book-word-section" aria-labelledby="book-content-title"><div className="section-heading"><div><h2 id="book-content-title">词书内容</h2><p>按掌握情况，找到接下来要练的词。</p></div><div className="search-field"><Magnifier /><Input aria-label="搜索单词或释义" placeholder="搜索单词或释义…" value={search} onChange={event => setSearch(event.target.value)} /></div></div><div className="library-filter-scroll"><Segment aria-label="单词学习状态" selectedKey={filter} onSelectionChange={key => setFilter(key as WordFilter)} className="word-segment library-segment word-state-segment">{wordFilters.map(item => <Segment.Item id={item.id} key={item.id} aria-label={`${item.label} ${counts[item.id]} 词`}><span>{item.label}</span><span className="word-filter-count">{counts[item.id]}</span></Segment.Item>)}</Segment></div><div className="library-results"><span aria-live="polite">显示 {filteredWords.length} / {words.length} 词{filter === 'reinforce' && ' · 曾在速刷中犹豫的词'}</span>{(search || filter !== 'all') && <Button size="sm" variant="ghost" aria-label="清空搜索和状态筛选" onPress={clearFilters}>清空筛选</Button>}</div>{filteredWords.length > 0 ? <WordList words={filteredWords} /> : <Empty title={search ? '没有找到匹配的单词' : filter === 'all' ? '这本词书暂时没有单词' : `暂时没有${wordFilters.find(item => item.id === filter)?.label}的单词`} description={search ? '试试单词的一部分，或搜索中文释义。' : filter === 'reinforce' ? '速刷中选“不确定”，看释义后认出的词会出现在这里。' : '可以切换其他学习状态查看。'} action={(search || filter !== 'all') ? <Button variant="secondary" onPress={clearFilters}>查看全部单词</Button> : undefined} />}</section></div>
}

export function WordList({ words }: { words: Word[] }) {
  const refresh = useRefresh()
  const client = useQueryClient()
  const [busy, setBusy] = useState<number | null>(null)
  const toggle = async (word: Word) => {
    if (busy !== null) return
    setBusy(word.id)
    try { await api(`/favorites/${word.id}`, json('POST', { favorite: !word.favorite })); await refresh(); await client.invalidateQueries({ queryKey: ['books', String(word.bookId)] }) }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }
  if (!words.length) return <Empty title="这里暂时没有单词" description="开始学习或调整筛选，新的积累很快就会出现。" />
  return <ListView aria-label="单词列表" variant="secondary" selectionMode="none" className="word-list">{words.map(word => <ListView.Item id={word.id} key={word.id} textValue={word.text}><ListView.ItemContent><div className="word-list-main"><div className="word-list-heading"><ListView.Title lang="en">{word.text}</ListView.Title>{word.phonetic && <span className="phonetic-inline" lang="en">{word.phonetic}</span>}</div><ListView.Description>{word.meaning}</ListView.Description></div>{word.reinforce ? <Chip size="sm" color="warning" variant="soft">待巩固</Chip> : word.status === 'mastered' ? <Chip size="sm" color="success" variant="soft">已掌握</Chip> : null}</ListView.ItemContent><ListView.ItemAction><IconButton label={`播放 ${word.text} 发音`} onPress={() => pronounce(word.text)}><Volume /></IconButton><IconButton label={word.favorite ? `取消收藏 ${word.text}` : `收藏 ${word.text}`} isDisabled={busy !== null} className={word.favorite ? 'text-warning' : ''} onPress={() => { void toggle(word) }}><Star fill={word.favorite ? 'currentColor' : 'none'} /></IconButton></ListView.ItemAction></ListView.Item>)}</ListView>
}

export function FavoritesPage() {
  const favorites = useQuery({ queryKey: ['favorites'], queryFn: () => api<Word[]>('/favorites') })
  const [search, setSearch] = useState('')
  if (favorites.isPending) return <Loading />
  if (favorites.error) return <Failure error={favorites.error} retry={favorites.refetch} />
  return <div className="page-stack"><PageHeading eyebrow="属于你的词汇收藏" title="想再见一面的单词" description={`已收藏 ${favorites.data.length} 个单词。随手收藏，随时回来。`} action={<Input aria-label="搜索收藏" placeholder="搜索收藏单词…" value={search} onChange={event => setSearch(event.target.value)} />} /><WordList words={favorites.data.filter(word => `${word.text}${word.meaning}`.toLowerCase().includes(search.toLowerCase()))} /></div>
}

export function ModePicker({ mode }: { mode: 'sprint' | 'review' }) {
  const navigate = useNavigate()
  const books = useQuery({ queryKey: ['books'], queryFn: () => api<Book[]>('/books') })
  const sprint = mode === 'sprint'
  if (books.isPending) return <Loading />
  if (books.error) return <Failure error={books.error} retry={books.refetch} />
  return <div className="page-stack"><PageHeading eyebrow={sprint ? '让每一分钟，更有分量' : '在遗忘之前，再见一面'} title={sprint ? '临考速刷，专注薄弱之处' : '及时复习，让记忆更牢固'} description={sprint ? '选一本词书，凭第一反应判断。会的跳过，模糊的单独巩固。' : '根据间隔复习安排，优先唤醒即将遗忘的单词。'} /><div className="mode-book-grid">{books.data.map(book => <Card key={book.id} className="mode-book"><BookCover book={book} small /><div className="min-w-0 flex-1"><h3>{book.title}</h3><p>{sprint ? `${book.wordCount - book.learnedCount} 词尚未掌握` : `${book.dueCount} 词到期复习`}</p><div className="flex flex-wrap gap-2 mt-4"><Button size="sm" variant={sprint || book.dueCount ? 'primary' : 'secondary'} isDisabled={!sprint && book.dueCount === 0} onPress={() => navigate(`/study/${book.id}/${mode}`)}>{sprint ? '开始速刷' : book.dueCount ? '开始复习' : '暂未到期'}<ArrowRight /></Button>{sprint && <Button size="sm" variant="ghost" onPress={() => navigate(`/study/${book.id}/reinforce`)}>巩固列表</Button>}</div></div></Card>)}</div><p className="text-xs text-muted leading-6">{sprint ? '速刷进度自动保存。退出后重新进入，会继续筛选尚未掌握的单词；巩固列表与待刷列表独立。' : '已掌握的单词仍会进入到期复习。当前采用 SM-2 风格间隔调度，复习时间会根据你的回答调整。'}</p></div>
}
