import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Chip, Input } from '@heroui/react'
import { Segment } from '@heroui-pro/react/segment'
import { ListView } from '@heroui-pro/react/list-view'
import { ArrowRight, Thunderbolt, BookOpen, ArrowsRotateRight, Star, Volume, ArrowLeft, Magnifier } from '@gravity-ui/icons'
import { toast } from 'sonner'
import { api, json, useUser } from '@/lib/api'
import { patchWordFavorite } from '@/lib/library-cache'
import { pronounce } from '@/lib/speech'
import type { Book, User, Word } from '@/lib/types'
import { BookCard, BookCover, Empty, Failure, IconButton, Loading, PageHeading, Progress } from '@/components/shared'
import { ListPagination } from '@/components/list-pagination'
import './home-library.css'

type LibraryBook = Book & { newCount: number; unstartedCount: number; learningCount: number; reinforceCount: number; sprintCount: number }
type BookDetail = { book: LibraryBook; words: Word[]; total: number; offset: number; limit: number; hasMore: boolean }
type FavoritePage = { items: Word[]; total: number; offset: number; limit: number; hasMore: boolean }
type WordFilter = 'all' | 'new' | 'learning' | 'mastered' | 'reinforce'
const pageSize = 50
const wordFilters: { id: WordFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'new', label: '未学' },
  { id: 'learning', label: '学习中' },
  { id: 'mastered', label: '已掌握' },
  { id: 'reinforce', label: '待巩固' },
]

function useSearchTerm(value: string) {
  const [term, setTerm] = useState(value.trim())
  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(value.trim()), 180)
    return () => window.clearTimeout(timer)
  }, [value])
  return term
}

export function BooksPage() {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('全部')
  const navigate = useNavigate()
  const { data: user } = useUser()
  const books = useQuery({ queryKey: ['books'], queryFn: ({ signal }) => api<LibraryBook[]>('/books', { signal }), refetchInterval: 30_000 })
  if (books.isPending) return <Loading />
  if (books.error) return <Failure error={books.error} retry={books.refetch} />
  const currentBook = books.data.find(book => book.id === user?.activeBookId)
  const currentAction = currentBook?.dueCount ? { label: '继续复习', route: `/study/${currentBook.id}/review` } : currentBook?.newCount ? { label: '继续学新词', route: `/study/${currentBook.id}/learn` } : currentBook?.reinforceCount ? { label: '继续巩固', route: `/study/${currentBook.id}/reinforce` } : { label: '查看词书', route: `/books/${currentBook?.id}` }
  const categories = ['全部', ...new Set(books.data.map(book => book.category))]
  const filtered = books.data.filter(book => (category === '全部' || book.category === category) && `${book.title}${book.subtitle}${book.description}`.toLowerCase().includes(search.trim().toLowerCase()))
  const clearFilters = () => { setSearch(''); setCategory('全部') }
  return <div className="page-stack library-page"><PageHeading eyebrow="词书" title="选一本，学得更专注" description="按学习目标选择词书，也可以随时回到正在学的那一本。" />
    {currentBook && <Card className="library-current"><div className="library-current-summary"><BookCover book={currentBook} small /><div><span className="library-current-label">当前词书</span><h2>{currentBook.title}</h2><p>已掌握 {currentBook.learnedCount} / {currentBook.wordCount} 词{currentBook.dueCount > 0 ? ` · ${currentBook.dueCount} 词待复习` : currentBook.newCount > 0 ? ` · ${currentBook.newCount} 词可继续学习` : ''}</p><Progress label="当前词书掌握进度" value={currentBook.wordCount ? currentBook.learnedCount / currentBook.wordCount * 100 : 0} /></div></div><Button variant="outline" onPress={() => navigate(currentAction.route)}>{currentAction.label}<ArrowRight /></Button></Card>}
    <section className="library-catalog" aria-label="选择词书"><div className="filter-toolbar"><div className="library-filter-scroll"><Segment aria-label="词书分类" selectedKey={category} onSelectionChange={key => setCategory(String(key))} className="word-segment library-segment">{categories.map(item => <Segment.Item id={item} key={item}>{item}</Segment.Item>)}</Segment></div><div className="search-field"><Magnifier /><Input aria-label="搜索词书" maxLength={60} placeholder="搜索词书…" value={search} onChange={event => setSearch(event.target.value)} /></div></div><div className="library-results"><span aria-live="polite">共 {filtered.length} 本词书</span>{(search || category !== '全部') && <Button size="sm" variant="ghost" onPress={clearFilters}>清除筛选</Button>}</div>{filtered.length ? <div className="book-library-grid">{filtered.map(book => <BookCard key={book.id} book={book} selected={user?.activeBookId === book.id} onOpen={() => navigate(`/books/${book.id}`)} />)}</div> : <Empty title="还没找到这本词书" description="试试其他关键词，或切换到全部分类。" action={<Button variant="secondary" onPress={clearFilters}>清除筛选</Button>} />}</section></div>
}

export function BookDetailPage() {
  const { bookId } = useParams()
  // A new book starts with its own search, filter and pending-action state.
  return <BookDetailContent key={bookId} bookId={bookId!} />
}

function BookDetailContent({ bookId }: { bookId: string }) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const { data: user } = useUser()
  const [search, setSearch] = useState('')
  const query = useSearchTerm(search)
  const [filter, setFilter] = useState<WordFilter>('all')
  const [offset, setOffset] = useState(0)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const actionLock = useRef(false)
  const activeRequest = useRef<object | null>(null)
  const listHeading = useRef<HTMLHeadingElement | null>(null)
  useEffect(() => () => { activeRequest.current = null; actionLock.current = false }, [])
  const params = new URLSearchParams({ offset: String(offset), limit: String(pageSize), q: query, status: filter })
  const detail = useQuery({
    queryKey: ['books', bookId, 'words', { offset, query, filter }],
    queryFn: ({ signal }) => api<BookDetail>(`/books/${bookId}?${params}`, { signal }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  })
  useEffect(() => {
    if (detail.data && !detail.isPlaceholderData && offset > 0 && offset >= detail.data.total) setOffset(Math.max(0, Math.floor((detail.data.total - 1) / pageSize) * pageSize))
  }, [detail.data, detail.isPlaceholderData, offset])
  if (!detail.data) return detail.error ? <div className="page-stack library-page"><PageHeading title="词书内容" description="可以调整搜索条件，或重新加载词书。" /><Input aria-label="搜索单词或释义" maxLength={60} placeholder="搜索单词或释义…" value={search} onChange={event => { setSearch(event.target.value); setOffset(0) }} /><Failure error={detail.error} retry={detail.refetch} /><div className="flex gap-3"><Button variant="secondary" onPress={() => { setSearch(''); setFilter('all'); setOffset(0) }}>清空筛选</Button><Button variant="ghost" onPress={() => navigate('/books')}>全部词书</Button></div></div> : <Loading />
  const { book, words } = detail.data
  const counts: Record<WordFilter, number> = { all: book.wordCount, new: book.unstartedCount, learning: book.learningCount, mastered: book.learnedCount, reinforce: book.reinforceCount }
  const filtering = query !== search.trim()
  const clearFilters = () => { setSearch(''); setFilter('all'); setOffset(0) }
  const changePage = (nextOffset: number) => { setOffset(nextOffset); listHeading.current?.focus(); listHeading.current?.scrollIntoView({ block: 'start' }) }
  const chooseBook = async (mode?: 'learn' | 'review' | 'sprint' | 'reinforce') => {
    if (actionLock.current) return
    actionLock.current = true
    const request = {}
    activeRequest.current = request
    setPendingAction(mode || 'select')
    try {
      if (user?.activeBookId !== book.id) {
        const updated = await api<User>('/me', json('PATCH', { activeBookId: book.id }))
        if (activeRequest.current !== request) return
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
    <section className="book-overview"><BookCover book={book} /><div className="book-overview-copy"><div className="book-overview-labels"><Chip variant="soft">{book.category}</Chip>{user?.activeBookId === book.id && <Chip color="success" variant="soft">当前词书</Chip>}</div><h1>{book.title}</h1><p>{book.description}</p><div className="book-overview-counts"><span><strong>{book.wordCount}</strong>个单词</span><span><strong>{book.learnedCount}</strong>已掌握</span><span><strong>{book.dueCount}</strong>到期复习</span></div><div className="learning-progress-copy"><span>掌握进度</span><strong>{book.wordCount ? Math.round(book.learnedCount / book.wordCount * 100) : 0}%</strong></div><Progress label="词书掌握进度" value={book.wordCount ? book.learnedCount / book.wordCount * 100 : 0} /><div className="book-learning-actions"><Button variant={book.dueCount > 0 ? 'outline' : 'primary'} isDisabled={book.newCount === 0 || pendingAction !== null} isPending={pendingAction === 'learn'} onPress={() => { void chooseBook('learn') }}><BookOpen />{book.newCount ? `学新词 · ${Math.min(book.newCount, user?.dailyGoal || 20)} 词` : '新词已学完'}</Button><Button variant={book.dueCount > 0 ? 'primary' : 'outline'} isDisabled={book.dueCount === 0 || pendingAction !== null} isPending={pendingAction === 'review'} onPress={() => { void chooseBook('review') }}><ArrowsRotateRight />{book.dueCount ? `到期复习 · ${book.dueCount} 词` : '暂无到期复习'}</Button></div><div className="book-secondary-actions"><Button variant="ghost" isDisabled={pendingAction !== null || book.sprintCount === 0} isPending={pendingAction === 'sprint'} onPress={() => { void chooseBook('sprint') }}><Thunderbolt />{book.sprintCount ? `临考速刷 · ${book.sprintCount} 词` : '暂无待速刷词'}</Button>{book.reinforceCount > 0 && <Button variant="ghost" isDisabled={pendingAction !== null} isPending={pendingAction === 'reinforce'} onPress={() => { void chooseBook('reinforce') }}>巩固 {book.reinforceCount} 词</Button>}{user?.activeBookId !== book.id && <Button variant="ghost" isDisabled={pendingAction !== null} isPending={pendingAction === 'select'} onPress={() => { void chooseBook() }}>设为当前词书</Button>}</div></div></section>
    <section className="book-word-section" aria-labelledby="book-content-title"><div className="section-heading"><div><h2 id="book-content-title" ref={listHeading} tabIndex={-1}>词书内容</h2><p>按掌握情况，找到接下来要练的词。</p></div><div className="search-field"><Magnifier /><Input aria-label="搜索单词或释义" maxLength={60} placeholder="搜索单词或释义…" value={search} onChange={event => { setSearch(event.target.value); setOffset(0) }} /></div></div><div className="library-filter-scroll"><Segment aria-label="单词学习状态" selectedKey={filter} onSelectionChange={key => { setFilter(key as WordFilter); setOffset(0) }} className="word-segment library-segment word-state-segment">{wordFilters.map(item => <Segment.Item id={item.id} key={item.id} aria-label={`${item.label} ${counts[item.id]} 词`}><span>{item.label}</span><span className="word-filter-count">{counts[item.id]}</span></Segment.Item>)}</Segment></div><div className="library-results"><span aria-live="polite">{detail.isFetching || filtering ? '正在更新词条…' : `找到 ${detail.data.total} / ${book.wordCount} 词`}{filter === 'reinforce' && ' · 曾在速刷中犹豫的词'}</span>{(search || filter !== 'all') && <Button size="sm" variant="ghost" aria-label="清空搜索和状态筛选" onPress={clearFilters}>清空筛选</Button>}</div>{detail.error && <Failure error={detail.error} retry={detail.refetch} />}<div aria-busy={detail.isFetching || filtering}>{words.length > 0 ? <WordList words={words} disabled={detail.isPlaceholderData || filtering} /> : <Empty title={search ? '没有找到匹配的单词' : filter === 'all' ? '这本词书暂时没有单词' : `暂时没有${wordFilters.find(item => item.id === filter)?.label}的单词`} description={search ? '试试单词的一部分，或搜索中文释义。' : filter === 'reinforce' ? '速刷中选“不确定”，看释义后认出的词会出现在这里。' : '可以切换其他学习状态查看。'} action={(search || filter !== 'all') ? <Button variant="secondary" onPress={clearFilters}>查看全部单词</Button> : undefined} />}</div><ListPagination offset={detail.data.offset} limit={pageSize} total={detail.data.total} busy={detail.isFetching || filtering} onChange={changePage} /></section></div>
}

export function WordList({ words, disabled = false }: { words: Word[]; disabled?: boolean }) {
  const client = useQueryClient()
  const [pendingIds, setPendingIds] = useState<Set<number>>(() => new Set())
  const [overrides, setOverrides] = useState<Map<number, boolean>>(() => new Map())
  const pending = useRef(new Set<number>())
  useEffect(() => {
    setOverrides(current => {
      const next = new Map(current)
      for (const word of words) if (!pending.current.has(word.id) && next.get(word.id) === word.favorite) next.delete(word.id)
      return next.size === current.size ? current : next
    })
  }, [words, pendingIds])
  const toggle = async (word: Word) => {
    if (disabled || pending.current.has(word.id)) return
    const owner = client.getQueryData<User>(['me'])?.id
    const previous = overrides.get(word.id) ?? word.favorite
    const favorite = !previous
    const affected = { predicate: (query: { queryKey: readonly unknown[]; state: { data: unknown } }) => ['books', 'favorites', 'study', 'admin'].includes(String(query.queryKey[0])) && (patchWordFavorite(query.state.data, word.id, true) !== query.state.data || patchWordFavorite(query.state.data, word.id, false) !== query.state.data) }
    const patch = (value: boolean) => client.setQueriesData(affected, data => patchWordFavorite(data, word.id, value))
    pending.current.add(word.id)
    setPendingIds(new Set(pending.current))
    setOverrides(current => new Map(current).set(word.id, favorite))
    try {
      // Discard reads started before the mutation so they cannot overwrite the optimistic star.
      await client.cancelQueries(affected)
      if (client.getQueryData<User>(['me'])?.id !== owner) return
      patch(favorite)
      await api(`/favorites/${word.id}`, json('POST', { favorite }))
      if (client.getQueryData<User>(['me'])?.id !== owner) return
      await client.cancelQueries(affected)
      patch(favorite)
      void client.invalidateQueries({ queryKey: ['favorites'] })
      void client.invalidateQueries({ queryKey: ['stats'] })
    } catch (e) {
      if (client.getQueryData<User>(['me'])?.id !== owner) return
      patch(previous)
      setOverrides(current => new Map(current).set(word.id, previous))
      toast.error((e as Error).message)
    } finally {
      pending.current.delete(word.id)
      setPendingIds(new Set(pending.current))
    }
  }
  if (!words.length) return <Empty title="这里暂时没有单词" description="开始学习或调整筛选，新的积累很快就会出现。" />
  return <ListView aria-label="单词列表" variant="secondary" selectionMode="none" className="word-list">{words.map(word => {
    const favorite = overrides.get(word.id) ?? word.favorite
    const learning = word.status === 'learning' || (word.status === 'new' && word.learnStage === 1)
    return <ListView.Item id={word.id} key={word.id} textValue={word.text}><ListView.ItemContent><div className="word-list-main"><div className="word-list-heading"><ListView.Title lang="en">{word.text}</ListView.Title>{word.phonetic && <span className="phonetic-inline" lang="en">{word.phonetic}</span>}</div><ListView.Description>{word.meaning}</ListView.Description></div>{word.reinforce ? <Chip size="sm" color="warning" variant="soft">待巩固</Chip> : word.status === 'mastered' ? <Chip size="sm" color="success" variant="soft">已掌握</Chip> : learning ? <Chip size="sm" color="accent" variant="soft">{word.learnStage === 1 ? '学习中 · 回忆英文' : '学习中'}</Chip> : null}</ListView.ItemContent><ListView.ItemAction><IconButton label={`播放 ${word.text} 发音`} onPress={() => pronounce(word.text)}><Volume /></IconButton><IconButton label={favorite ? `取消收藏 ${word.text}` : `收藏 ${word.text}`} aria-pressed={favorite} isDisabled={disabled || pendingIds.has(word.id)} isPending={pendingIds.has(word.id)} className={favorite ? 'text-warning' : ''} onPress={() => { void toggle(word) }}><Star fill={favorite ? 'currentColor' : 'none'} /></IconButton></ListView.ItemAction></ListView.Item>
  })}</ListView>
}

export function FavoritesPage() {
  const [search, setSearch] = useState('')
  const query = useSearchTerm(search)
  const [offset, setOffset] = useState(0)
  const results = useRef<HTMLDivElement | null>(null)
  const params = new URLSearchParams({ paged: '1', offset: String(offset), limit: String(pageSize), q: query })
  const favorites = useQuery({ queryKey: ['favorites', { offset, query }], queryFn: ({ signal }) => api<FavoritePage>(`/favorites?${params}`, { signal }), placeholderData: keepPreviousData })
  useEffect(() => {
    if (favorites.data && !favorites.isPlaceholderData && offset > 0 && offset >= favorites.data.total) setOffset(Math.max(0, Math.floor((favorites.data.total - 1) / pageSize) * pageSize))
  }, [favorites.data, favorites.isPlaceholderData, offset])
  if (!favorites.data) return favorites.error ? <div className="page-stack library-page"><PageHeading title="想再见一面的单词" description="可以调整搜索条件，或重新加载收藏。" /><Input aria-label="搜索收藏" maxLength={60} placeholder="搜索收藏单词…" value={search} onChange={event => { setSearch(event.target.value); setOffset(0) }} /><Failure error={favorites.error} retry={favorites.refetch} /><Button className="self-start" variant="secondary" onPress={() => { setSearch(''); setOffset(0) }}>清空搜索</Button></div> : <Loading />
  return <div className="page-stack library-page favorites-page"><PageHeading eyebrow="属于你的词汇收藏" title="想再见一面的单词" description="随手收藏，随时回来。" action={<Input aria-label="搜索收藏" maxLength={60} placeholder="搜索收藏单词…" value={search} onChange={event => { setSearch(event.target.value); setOffset(0) }} />} /><div className="library-results"><span aria-live="polite">{favorites.isFetching || query !== search.trim() ? '正在查找收藏…' : `${query ? '找到' : '已收藏'} ${favorites.data.total} 个单词`}</span>{search && <Button variant="ghost" onPress={() => { setSearch(''); setOffset(0) }}>清空搜索</Button>}</div>{favorites.error && <Failure error={favorites.error} retry={favorites.refetch} />}<div ref={results} tabIndex={-1} aria-label="收藏搜索结果" aria-busy={favorites.isFetching || query !== search.trim()}>{favorites.data.items.length ? <WordList words={favorites.data.items} disabled={favorites.isPlaceholderData || query !== search.trim()} /> : <Empty title={query ? '没有找到这个收藏词' : '这里暂时没有收藏'} description={query ? '试试单词的一部分或中文释义。' : '在词书或答题页面点击星标，想再见的词会留在这里。'} action={query ? <Button variant="secondary" onPress={() => { setSearch(''); setOffset(0) }}>查看全部收藏</Button> : undefined} />}</div><ListPagination offset={favorites.data.offset} limit={pageSize} total={favorites.data.total} busy={favorites.isFetching || query !== search.trim()} onChange={next => { setOffset(next); results.current?.focus(); results.current?.scrollIntoView({ block: 'start' }) }} /></div>
}

export function ModePicker({ mode }: { mode: 'sprint' | 'review' }) {
  const navigate = useNavigate()
  const books = useQuery({ queryKey: ['books'], queryFn: ({ signal }) => api<LibraryBook[]>('/books', { signal }), refetchInterval: 30_000 })
  const sprint = mode === 'sprint'
  if (books.isPending) return <Loading />
  if (books.error) return <Failure error={books.error} retry={books.refetch} />
  return <div className="page-stack library-page mode-picker-page"><PageHeading eyebrow={sprint ? '让每一分钟，更有分量' : '在遗忘之前，再见一面'} title={sprint ? '临考速刷，专注薄弱之处' : '及时复习，让记忆更牢固'} description={sprint ? '选一本词书，凭第一反应判断。会的跳过，模糊的单独巩固。' : '根据间隔复习安排，优先唤醒即将遗忘的单词。'} /><div className="mode-book-grid">{books.data.map(book => {
    const count = sprint ? book.sprintCount : book.dueCount
    return <Card key={book.id} className="mode-book"><BookCover book={book} small /><div className="min-w-0 flex-1"><h3>{book.title}</h3><p>{sprint ? `${count} 词待速刷${book.reinforceCount ? ` · ${book.reinforceCount} 词待巩固` : ''}` : `${count} 词到期复习`}</p><div className="flex flex-wrap gap-2 mt-4"><Button variant={count ? 'primary' : 'secondary'} isDisabled={count === 0} onPress={() => navigate(`/study/${book.id}/${mode}`)}>{count ? sprint ? '开始速刷' : '开始复习' : sprint ? '暂无待刷词' : '暂未到期'}<ArrowRight /></Button>{sprint && book.reinforceCount > 0 && <Button variant={count ? 'ghost' : 'outline'} onPress={() => navigate(`/study/${book.id}/reinforce`)}>巩固 {book.reinforceCount} 词</Button>}</div></div></Card>
  })}</div><p className="library-mode-note">{sprint ? '速刷进度自动保存。重新进入时继续筛选待刷单词；看过释义后认出的词进入巩固列表。' : '已掌握的单词仍会进入到期复习。复习时间会根据你的回答调整，页面会自动更新到期数量。'}</p></div>
}
