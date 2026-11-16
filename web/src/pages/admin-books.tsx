import { useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Chip, Input, Label, TextArea, TextField } from '@heroui/react'
import { DataGrid, type DataGridColumn } from '@heroui-pro/react/data-grid'
import { NativeSelect } from '@heroui-pro/react/native-select'
import { ArrowLeft, ArrowUpFromLine, Pencil, Plus, TrashBin } from '@gravity-ui/icons'
import { toast } from 'sonner'
import { Empty, Failure, IconButton, Loading, PageHeading } from '@/components/shared'
import { api, json, useRefresh, useUser } from '@/lib/api'
import { validateImportWords, type ImportWord } from '@/lib/form-validation'
import { useFormDraft } from '@/hooks/use-form-draft'
import type { Book, Word } from '@/lib/types'
import { count } from '@/lib/utils'
import { AdminDialog, DeleteDialog } from './admin-common'

type BookForm = Pick<Book, 'title' | 'subtitle' | 'description' | 'category' | 'color'>
const emptyBook: BookForm = { title: '', subtitle: '', description: '', category: '自定义', color: '#397d67' }
const colors = [{ value: '#397d67', name: '松绿' }, { value: '#3e6c70', name: '青灰' }, { value: '#7770a0', name: '雾紫' }, { value: '#b37350', name: '陶橙' }, { value: '#697d9c', name: '雾蓝' }, { value: '#a27686', name: '豆沙' }]
const importExample = JSON.stringify([{ text: 'curiosity', phonetic: '/ˌkjʊriˈɑːsəti/', meaning: 'n. 好奇心', example: 'Curiosity opens new doors.', exampleMeaning: '好奇心打开新的大门。' }], null, 2)

function BookEditor({ book, onClose, onSaved }: { book?: Book; onClose: () => void; onSaved: (book: Book) => void }) {
  const { data: user } = useUser()
  const initial = book ? { title: book.title, subtitle: book.subtitle, description: book.description, category: book.category, color: book.color } : { ...emptyBook }
  const draft = useFormDraft(`word-draft:${user?.id}:${book ? `book:${book.id}` : 'new-book'}`, initial)
  const form = draft.value
  const mutation = useMutation({
    mutationFn: () => api<Book>(book ? `/admin/books/${book.id}` : '/admin/books', json(book ? 'PATCH' : 'POST', form)),
    onSuccess: result => { draft.reset({ title: result.title, subtitle: result.subtitle, description: result.description, category: result.category, color: result.color }); onSaved(result) },
  })
  const set = (name: keyof BookForm, value: string) => draft.setValue(current => ({ ...current, [name]: value }))
  const submit = (event: FormEvent) => { event.preventDefault(); if (!mutation.isPending) mutation.mutate() }
  return <AdminDialog open title={book ? '编辑词书' : '创建词书'} onClose={onClose} busy={mutation.isPending} dirty={draft.dirty} onDiscard={() => draft.reset(initial)} footer={<><Button variant="secondary" isDisabled={mutation.isPending} onPress={onClose}>关闭并保留草稿</Button><Button type="submit" form="book-editor" isPending={mutation.isPending} isDisabled={!draft.dirty || !form.title.trim()}>{book ? '保存修改' : '创建词书'}</Button></>}>
    <form id="book-editor" onSubmit={submit} className="space-y-4">
      {draft.restored && <p className="text-sm text-muted" role="status">已恢复未保存的词书草稿。</p>}
      <TextField isRequired isDisabled={mutation.isPending} value={form.title} onChange={value => set('title', value)}><Label>词书名称</Label><Input variant="secondary" maxLength={120} placeholder="例如：考研核心词汇" /></TextField>
      <TextField isDisabled={mutation.isPending} value={form.subtitle} onChange={value => set('subtitle', value)}><Label>副标题</Label><Input variant="secondary" maxLength={200} placeholder="一句话介绍这本词书" /></TextField>
      <div className="grid grid-cols-2 gap-4"><TextField isDisabled={mutation.isPending} value={form.category} onChange={value => set('category', value)}><Label>分类</Label><Input variant="secondary" maxLength={40} placeholder="例如：考研" /></TextField><NativeSelect fullWidth variant="secondary"><Label htmlFor="book-color">主题色</Label><NativeSelect.Trigger id="book-color" disabled={mutation.isPending} value={form.color} onChange={event => set('color', event.target.value)}>{!colors.some(color => color.value === form.color) && <NativeSelect.Option value={form.color}>当前主题</NativeSelect.Option>}{colors.map(color => <NativeSelect.Option key={color.value} value={color.value}>{color.name}</NativeSelect.Option>)}<NativeSelect.Indicator /></NativeSelect.Trigger></NativeSelect></div>
      <TextField isDisabled={mutation.isPending} value={form.description} onChange={value => set('description', value)}><Label>词书介绍</Label><TextArea variant="secondary" maxLength={2000} rows={3} placeholder="适合谁学习，包含什么内容" /></TextField>
      {mutation.isError && <p role="alert" className="text-sm text-danger">{mutation.error.message}</p>}
    </form>
  </AdminDialog>
}

export function AdminBooks() {
  const navigate = useNavigate()
  const refresh = useRefresh()
  const [search, setSearch] = useState('')
  const [editor, setEditor] = useState<Book | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Book | null>(null)
  const query = useQuery({ queryKey: ['admin', 'books'], queryFn: () => api<Book[]>('/admin/books') })
  const remove = useMutation({ mutationFn: (book: Book) => api(`/admin/books/${book.id}`, json('DELETE')), onSuccess: async () => { setDeleting(null); toast.success('词书已删除'); await refresh() }, onError: error => toast.error(error.message) })
  const books = useMemo(() => (query.data || []).filter(book => `${book.title} ${book.subtitle} ${book.category}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [query.data, search])
  const columns: DataGridColumn<Book>[] = [
    { id: 'title', header: '词书', accessorKey: 'title', allowsSorting: true, isRowHeader: true, minWidth: 230, cell: book => <div className="py-1"><Button variant="ghost" className="h-auto justify-start p-0 font-medium" onPress={() => navigate(`/admin/books/${book.id}`)}>{book.title}</Button><p className="mt-1 text-xs text-muted">{book.subtitle}</p></div> },
    { id: 'category', header: '分类', accessorKey: 'category', allowsSorting: true, minWidth: 100, cell: book => <Chip size="sm" variant="soft">{book.category || '未分类'}</Chip> },
    { id: 'wordCount', header: '单词数量', accessorKey: 'wordCount', align: 'end', allowsSorting: true, minWidth: 100, cell: book => <span className="tabular-nums">{count(book.wordCount)} 词</span> },
    { id: 'actions', header: '操作', align: 'end', width: 164, cell: book => <div className="flex items-center justify-end gap-1"><Button size="sm" variant="ghost" onPress={() => navigate(`/admin/books/${book.id}`)}>管理词条</Button><IconButton label={`编辑${book.title}`} size="sm" onPress={() => setEditor(book)}><Pencil /></IconButton><IconButton label={`删除${book.title}`} size="sm" variant="danger-soft" onPress={() => setDeleting(book)}><TrashBin /></IconButton></div> },
  ]
  if (query.isPending) return <Loading label="正在加载词书" />
  if (query.isError) return <Failure error={query.error} retry={query.refetch} />
  return <div className="space-y-6">
    <PageHeading eyebrow="内容管理" title="词书管理" description="整理每一本词书，让好的内容触手可及。" action={<Button onPress={() => setEditor('new')}><Plus />创建词书</Button>} />
    <div className="flex flex-wrap items-center gap-3"><Input aria-label="搜索词书" placeholder="搜索词书名称、分类" className="w-full max-w-sm" value={search} onChange={event => setSearch(event.target.value)} /><span className="ml-auto text-sm tabular-nums text-muted">{count(books.length)} 本词书 · {count(books.reduce((sum, book) => sum + book.wordCount, 0))} 词</span></div>
    <DataGrid aria-label="词书管理列表" data={books} columns={columns} getRowId={book => book.id} selectionMode="none" variant="secondary" contentClassName="min-w-[660px]" scrollContainerClassName="max-h-[65vh] overflow-auto" stickyHeader renderEmptyState={() => <Empty title={search ? '没有匹配的词书' : '创建第一本词书'} description={search ? '试试其他名称或分类。' : '创建词书后，可以批量导入你的单词。'} />} />
    {editor !== null && <BookEditor book={editor === 'new' ? undefined : editor} onClose={() => setEditor(null)} onSaved={book => { const isNew = editor === 'new'; setEditor(null); toast.success(isNew ? '词书已创建，现在可以导入单词' : '词书已更新'); void refresh(); if (isNew) navigate(`/admin/books/${book.id}`) }} />}
    {deleting && <DeleteDialog title={`删除「${deleting.title}」？`} description={`这将删除该词书的 ${deleting.wordCount} 个单词，以及所有用户对应的学习进度和收藏。此操作无法撤销。`} busy={remove.isPending} onCancel={() => setDeleting(null)} onConfirm={() => remove.mutate(deleting)} />}
  </div>
}

function ImportDialog({ book, onClose, onImported }: { book: Book; onClose: () => void; onImported: () => void }) {
  const { data: user } = useUser()
  const draft = useFormDraft(`word-draft:${user?.id}:book:${book.id}:import`, '')
  const source = draft.value
  const [error, setError] = useState('')
  const [readingFile, setReadingFile] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const mutation = useMutation({ mutationFn: (words: ImportWord[]) => api<{ imported: number }>(`/admin/books/${book.id}/words`, json('POST', { words })), onSuccess: result => { draft.reset(''); toast.success(`已导入 ${result.imported} 个单词`); onImported() } })
  const importWords = () => {
    if (readingFile || mutation.isPending) return
    setError('')
    try { mutation.mutate(validateImportWords(source)) }
    catch (caught) { setError(caught instanceof Error ? caught.message : '导入内容无效。') }
  }
  const fillExample = () => {
    if (source.trim()) { setError('已有导入内容；请先清空后再填入格式示例。'); return }
    draft.setValue(importExample); setError('')
  }
  return <AdminDialog open wide title="批量导入单词" onClose={onClose} busy={mutation.isPending || readingFile} dirty={draft.dirty} onDiscard={() => draft.reset('')} footer={<><Button variant="secondary" isDisabled={mutation.isPending || readingFile} onPress={onClose}>关闭并保留草稿</Button><Button isPending={mutation.isPending || readingFile} isDisabled={!source.trim()} onPress={importWords}>导入单词</Button></>}>
    <div className="space-y-4"><p className="text-sm leading-6 text-muted">导入到「{book.title}」。同名单词将更新已提供的字段，省略字段会保留原内容；每次最多 5,000 词。</p>
      {draft.restored && <p className="text-sm text-muted" role="status">已恢复当前标签页中的导入草稿。</p>}
      <p className="text-xs leading-6 text-muted">导入草稿会留在当前标签页；显式传入空字符串会清空原字段。选择文件会替换当前草稿，请先保存需要保留的文本。</p>
      <div className="flex items-center gap-2"><Button variant="secondary" size="sm" isDisabled={mutation.isPending || readingFile} onPress={() => file.current?.click()}><ArrowUpFromLine />选择 JSON 文件</Button><Button variant="ghost" size="sm" isDisabled={mutation.isPending || readingFile || Boolean(source.trim())} onPress={fillExample}>填入格式示例</Button></div>
      <input ref={file} type="file" accept=".json,application/json" className="hidden" disabled={mutation.isPending || readingFile} aria-label="选择单词 JSON 文件" onChange={async event => { const selected = event.target.files?.[0]; if (!selected) return; if (selected.size > 4 * 1024 * 1024) { setError('文件不能超过 4 MB。'); return } setReadingFile(true); try { draft.setValue(await selected.text()); setError('') } catch { setError('文件读取失败，请重新选择。') } finally { setReadingFile(false); event.target.value = '' } }} />
      <TextField isDisabled={mutation.isPending || readingFile} value={source} onChange={value => { draft.setValue(value); setError('') }}><Label>JSON 内容</Label><TextArea variant="secondary" rows={12} className="font-mono text-xs" placeholder={importExample} spellCheck={false} /></TextField>
      {(error || mutation.isError) && <p role="alert" className="text-sm text-danger">{error || mutation.error?.message}</p>}
    </div>
  </AdminDialog>
}

export function AdminBookDetail({ id }: { id: number }) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const refresh = useRefresh()
  const [filters, setFilters] = useState({ search: '', offset: 0 })
  const search = filters.search
  const pageSize = 50
  const [importing, setImporting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState<Word | null>(null)
  const query = useQuery({
    queryKey: ['admin', 'book', id, filters.search.trim(), filters.offset],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ offset: String(filters.offset), limit: String(pageSize), q: filters.search.trim() })
      return api<{ book: Book; words: Word[]; total: number; offset: number; limit: number; hasMore: boolean }>(`/books/${id}?${params}`, { signal })
    },
    placeholderData: keepPreviousData,
  })
  const update = async () => { await Promise.all([refresh(), client.invalidateQueries({ queryKey: ['admin', 'book', id] }), client.invalidateQueries({ queryKey: ['books', id] })]) }
  const remove = useMutation({ mutationFn: (word: Word) => api(`/admin/words/${word.id}`, json('DELETE')), onSuccess: async () => { setDeleting(null); if (words.length === 1 && filters.offset > 0) setFilters(current => ({ ...current, offset: Math.max(0, current.offset - pageSize) })); toast.success('单词已删除'); await update() }, onError: error => toast.error(error.message) })
  const words = query.data?.words || []
  const columns: DataGridColumn<Word>[] = [
    { id: 'text', header: '单词', accessorKey: 'text', isRowHeader: true, minWidth: 160, cell: word => <div className="py-1"><p className="font-medium">{word.text}</p><p className="mt-1 text-xs text-muted">{word.phonetic}</p></div> },
    { id: 'meaning', header: '释义', accessorKey: 'meaning', minWidth: 210, cell: word => <p className="max-w-xs whitespace-normal leading-6">{word.meaning}</p> },
    { id: 'example', header: '例句', accessorKey: 'example', minWidth: 280, cell: word => <div className="max-w-md whitespace-normal py-1"><p className="text-sm leading-6">{word.example || '—'}</p>{word.exampleMeaning && <p className="mt-1 text-xs leading-5 text-muted">{word.exampleMeaning}</p>}</div> },
    { id: 'actions', header: '操作', align: 'end', width: 72, cell: word => <IconButton label={`删除 ${word.text}`} variant="danger-soft" size="sm" onPress={() => setDeleting(word)}><TrashBin /></IconButton> },
  ]
  if (query.isPending) return <Loading label="正在加载词书内容" />
  if (query.isError) return <Failure error={query.error} retry={query.refetch} />
  const { book } = query.data
  return <div className="space-y-6">
    <Button variant="ghost" className="-ml-3" onPress={() => navigate('/admin/books')}><ArrowLeft />全部词书</Button>
    <PageHeading eyebrow={book.category || '词书管理'} title={book.title} description={book.subtitle} action={<div className="flex flex-wrap gap-2"><Button variant="secondary" onPress={() => setEditing(true)}>编辑信息</Button><Button onPress={() => setImporting(true)}><ArrowUpFromLine />导入单词</Button></div>} />
    {book.description && <Card variant="secondary" className="p-4"><p className="text-sm leading-6 text-muted">{book.description}</p></Card>}
    <div className="flex flex-wrap items-center gap-3"><Input aria-label="搜索词书单词" placeholder="搜索单词或释义" className="w-full max-w-sm" value={search} onChange={event => setFilters({ search: event.target.value, offset: 0 })} /><span className="ml-auto text-sm tabular-nums text-muted" aria-live="polite">{query.isFetching ? '正在更新…' : `共 ${count(query.data.total)} 个单词`}</span></div>
    <DataGrid aria-label={`${book.title}词条`} data={words} columns={columns} getRowId={word => word.id} selectionMode="none" variant="secondary" contentClassName="min-w-[760px]" scrollContainerClassName="max-h-[60vh] overflow-auto" stickyHeader renderEmptyState={() => <Empty title={search ? '没有找到这个单词' : '这本词书还没有单词'} description={search ? '换一个单词或中文释义试试。' : '导入 JSON 文件，开始建立你的专属词库。'} action={!search && <Button onPress={() => setImporting(true)}>导入单词</Button>} />} />
    <nav aria-label="词条列表分页" className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm tabular-nums text-muted">{query.data.total ? `${count(filters.offset + 1)}–${count(filters.offset + words.length)} / ${count(query.data.total)} 词` : '暂无匹配单词'} · 每页 {pageSize} 词</p><div className="flex gap-2"><Button variant="secondary" isDisabled={filters.offset === 0 || query.isFetching} onPress={() => setFilters(current => ({ ...current, offset: Math.max(0, current.offset - pageSize) }))}>上一页</Button><Button variant="secondary" isDisabled={!query.data.hasMore || query.isFetching} onPress={() => setFilters(current => ({ ...current, offset: current.offset + pageSize }))}>下一页</Button></div></nav>
    {editing && <BookEditor book={book} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); toast.success('词书已更新'); void update() }} />}
    {importing && <ImportDialog book={book} onClose={() => setImporting(false)} onImported={() => { setImporting(false); void update() }} />}
    {deleting && <DeleteDialog title={`删除「${deleting.text}」？`} description="这个单词及所有用户对应的学习进度和收藏将被删除，且无法撤销。" busy={remove.isPending} onCancel={() => setDeleting(null)} onConfirm={() => remove.mutate(deleting)} />}
  </div>
}
