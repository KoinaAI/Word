import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Chip, Input } from '@heroui/react'
import { Segment, ListView } from '@heroui-pro/react'
import { ArrowRight, Thunderbolt, BookOpen, ArrowsRotateRight, Star, Volume, ArrowLeft, Magnifier, Check } from '@gravity-ui/icons'
import { toast } from 'sonner'
import { api, json, useRefresh, useUser } from '@/lib/api'
import { pronounce } from '@/lib/speech'
import type { Book, User, Word } from '@/lib/types'
import { BookCard, BookCover, Empty, Failure, IconButton, Loading, PageHeading, Progress } from '@/components/shared'

export function BooksPage() {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('全部')
  const navigate = useNavigate()
  const { data: user } = useUser()
  const books = useQuery({ queryKey: ['books'], queryFn: () => api<Book[]>('/books') })
  if (books.isPending) return <Loading />
  if (books.error) return <Failure error={books.error} retry={books.refetch} />
  const categories = ['全部', ...new Set(books.data.map(book => book.category))]
  const filtered = books.data.filter(book => (category === '全部' || book.category === category) && `${book.title}${book.subtitle}${book.description}`.toLowerCase().includes(search.toLowerCase()))
  return <div className="page-stack"><PageHeading eyebrow="选一本，开启新的可能" title="你的词汇世界，从这里开始" description="考试、留学，或只是想看懂更大的世界，总有一本适合你。" /><div className="filter-toolbar"><div className="overflow-x-auto max-w-full"><Segment aria-label="词书分类" selectedKey={category} onSelectionChange={key => setCategory(String(key))} className="w-max">{categories.map(item => <Segment.Item id={item} key={item}>{item}</Segment.Item>)}</Segment></div><div className="search-field"><Magnifier /><Input aria-label="搜索词书" placeholder="搜索词书…" value={search} onChange={event => setSearch(event.target.value)} /></div></div><div className="flex justify-between text-sm text-muted"><span>{filtered.length} 本精选词书</span><span>可在后台导入完整词库</span></div>{filtered.length ? <div className="book-library-grid">{filtered.map(book => <BookCard key={book.id} book={book} selected={user?.activeBookId === book.id} onOpen={() => navigate(`/books/${book.id}`)} />)}</div> : <Empty title="还没找到这本词书" description="试试其他关键词，或切换到全部分类。" action={<Button variant="secondary" onPress={() => { setSearch(''); setCategory('全部') }}>清除筛选</Button>} />}</div>
}

export function BookDetailPage() {
  const { bookId } = useParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const { data: user } = useUser()
  const [search, setSearch] = useState('')
  const [pending, setPending] = useState(false)
  const detail = useQuery({ queryKey: ['books', bookId], queryFn: () => api<{book: Book; words: Word[]}>(`/books/${bookId}`) })
  if (detail.isPending) return <Loading />
  if (detail.error) return <Failure error={detail.error} retry={detail.refetch} />
  const { book, words } = detail.data
  const setActive = async () => {
    setPending(true)
    try { const updated = await api<User>('/me', json('PATCH', { activeBookId: book.id })); client.setQueryData(['me'], updated); toast.success('已设为当前词书') }
    catch (e) { toast.error((e as Error).message) } finally { setPending(false) }
  }
  return <div className="page-stack"><Button variant="ghost" size="sm" className="self-start" onPress={() => navigate('/books')}><ArrowLeft />全部词书</Button><div className="book-detail-hero"><BookCover book={book} /><div><Chip variant="soft">{book.category} · 精选词书</Chip><h1>{book.title}</h1><p>{book.description}</p><div className="book-detail-counts"><span><strong>{book.wordCount}</strong> 个单词</span><span><strong>{book.learnedCount}</strong> 已掌握</span><span><strong>{book.dueCount}</strong> 待复习</span></div><Progress label="词书进度" value={book.wordCount ? book.learnedCount / book.wordCount * 100 : 0} /><div className="flex flex-wrap gap-3 mt-6"><Button onPress={() => navigate(`/study/${book.id}/learn`)}>开始学习 <ArrowRight /></Button><Button variant="outline" onPress={() => navigate(`/study/${book.id}/sprint`)}><Thunderbolt />临考速刷</Button><Button variant="ghost" isDisabled={user?.activeBookId === book.id} isPending={pending} onPress={() => { void setActive() }}>{user?.activeBookId === book.id ? '当前词书' : '设为当前词书'}</Button></div></div></div><div className="section-heading"><div><h2>词书内容</h2><p>先认识一下，即将成为老朋友的单词。</p></div><Input aria-label="搜索单词" placeholder="搜索单词或释义…" className="max-w-64" value={search} onChange={event => setSearch(event.target.value)} /></div><WordList words={words.filter(word => `${word.text}${word.meaning}`.toLowerCase().includes(search.toLowerCase()))} /></div>
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
  return <ListView aria-label="单词列表" variant="secondary" selectionMode="none" className="word-list">{words.map(word => <ListView.Item id={word.id} key={word.id} textValue={word.text}><ListView.ItemContent><div className="word-list-main"><ListView.Title>{word.text}<span className="phonetic-inline">{word.phonetic}</span></ListView.Title><ListView.Description>{word.meaning}</ListView.Description></div>{word.reinforce ? <Chip size="sm" color="warning" variant="soft">待巩固</Chip> : word.status === 'mastered' ? <Chip size="sm" color="success" variant="soft">已掌握</Chip> : null}</ListView.ItemContent><ListView.ItemAction><IconButton label={`播放 ${word.text} 发音`} onPress={() => pronounce(word.text)}><Volume /></IconButton><IconButton label={word.favorite ? `取消收藏 ${word.text}` : `收藏 ${word.text}`} isDisabled={busy !== null} className={word.favorite ? 'text-warning' : ''} onPress={() => { void toggle(word) }}><Star fill={word.favorite ? 'currentColor' : 'none'} /></IconButton></ListView.ItemAction></ListView.Item>)}</ListView>
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
  return <div className="page-stack"><PageHeading eyebrow={sprint ? '让每一分钟，更有分量' : '在遗忘之前，再见一面'} title={sprint ? '临考速刷，专注薄弱之处' : '及时复习，让记忆更牢固'} description={sprint ? '选一本词书，凭第一反应判断。会的跳过，模糊的单独巩固。' : '根据间隔复习安排，优先唤醒即将遗忘的单词。'} /><div className="mode-explainer">{(sprint ? [{ icon: Check, title: '会', text: '直接标记已掌握' }, { icon: BookOpen, title: '不确定', text: '看释义后决定，记起则加入巩固' }, { icon: ArrowsRotateRight, title: '不会', text: '保留待刷，下一轮再来' }] : [{ icon: ClockIcon, title: '按时回顾', text: '根据回答安排下一次复习' }, { icon: ArrowsRotateRight, title: '循序渐进', text: '记住后间隔逐步延长' }, { icon: Thunderbolt, title: '重点巩固', text: '忘记的词十分钟后再见' }]).map(item => <div key={item.title}><span><item.icon /></span><div><strong>{item.title}</strong><p>{item.text}</p></div></div>)}</div><div className="mode-book-grid">{books.data.map(book => <Card key={book.id} className="mode-book"><BookCover book={book} small /><div className="min-w-0 flex-1"><h3>{book.title}</h3><p>{sprint ? `${book.wordCount - book.learnedCount} 词尚未掌握` : `${book.dueCount} 词到期复习`}</p><div className="flex flex-wrap gap-2 mt-4"><Button size="sm" variant={sprint || book.dueCount ? 'primary' : 'secondary'} isDisabled={!sprint && book.dueCount === 0} onPress={() => navigate(`/study/${book.id}/${mode}`)}>{sprint ? '开始速刷' : book.dueCount ? '开始复习' : '暂未到期'}<ArrowRight /></Button>{sprint && <Button size="sm" variant="ghost" onPress={() => navigate(`/study/${book.id}/reinforce`)}>巩固列表</Button>}</div></div></Card>)}</div><p className="text-xs text-muted leading-6">{sprint ? '速刷进度自动保存。退出后重新进入，会继续筛选尚未掌握的单词；巩固列表与待刷列表独立。' : '已掌握的单词仍会进入到期复习。当前采用 SM-2 风格间隔调度，复习时间会根据你的回答调整。'}</p></div>
}
function ClockIcon() { return <ArrowsRotateRight /> }
