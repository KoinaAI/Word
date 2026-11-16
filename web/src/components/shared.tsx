import { lazy, Suspense, type ComponentProps, type ReactNode, type CSSProperties } from 'react'
import { Button, Card, Chip, ProgressBar, Tooltip } from '@heroui/react'
import { EmptyState } from '@heroui-pro/react/empty-state'
import { BookOpen, ArrowRotateLeft, CircleExclamation } from '@gravity-ui/icons'
import type { Activity, Book } from '@/lib/types'

export function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <header className="page-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="page-description">{description}</p>}</div>{action}</header>
}
export function IconButton({ label, children, ...props }: Omit<ComponentProps<typeof Button>, 'children'> & { label: string; children: ReactNode }) {
  return <Tooltip delay={250}><Button isIconOnly aria-label={label} variant="ghost" {...props}>{children}</Button><Tooltip.Content>{label}</Tooltip.Content></Tooltip>
}
export function Progress({ value, label, className }: { value: number; label: string; className?: string }) {
  return <ProgressBar aria-label={label} value={Math.min(100, Math.max(0, value))} size="sm" className={className}><ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track></ProgressBar>
}
export function Loading({ label = '正在准备你的学习空间' }: { label?: string }) {
  return <div className="loading-state" role="status"><div className="loading-ring" /><span>{label}</span></div>
}
export function Failure({ error, retry }: { error: Error | null; retry?: () => unknown }) {
  return <EmptyState><EmptyState.Media variant="icon"><CircleExclamation className="text-danger" /></EmptyState.Media><EmptyState.Header><EmptyState.Title>暂时没有加载成功</EmptyState.Title><EmptyState.Description>{error?.message || '请检查网络后重试。'}</EmptyState.Description></EmptyState.Header>{retry && <EmptyState.Content><Button variant="secondary" onPress={() => { void retry() }}><ArrowRotateLeft />重新加载</Button></EmptyState.Content>}</EmptyState>
}
export function Empty({ title, description, action, icon }: { title: string; description: string; action?: ReactNode; icon?: ReactNode }) {
  return <EmptyState className="empty-content"><EmptyState.Media variant="icon">{icon || <BookOpen />}</EmptyState.Media><EmptyState.Header><EmptyState.Title>{title}</EmptyState.Title><EmptyState.Description>{description}</EmptyState.Description></EmptyState.Header>{action && <EmptyState.Content>{action}</EmptyState.Content>}</EmptyState>
}
const DeferredStat = lazy(() => import('./stat-card').then(module => ({ default: module.StatCard })))
const DeferredActivity = lazy(() => import('./activity-chart').then(module => ({ default: module.ActivityChart })))
export function Stat(props: { title: string; value: number; foot: string; icon: ReactNode }) {
  return <Suspense fallback={<div className="metric-card metric-placeholder"><span>{props.title}</span><strong>{props.value}</strong><small>{props.foot}</small></div>}><DeferredStat {...props} /></Suspense>
}
export function ActivityChart({ activity }: { activity: Activity[] }) {
  return <Suspense fallback={<div className="chart-placeholder" role="status">正在准备学习图表…</div>}><DeferredActivity activity={activity} /></Suspense>
}
const coverColors = ['#3e6c70', '#7770a0', '#b37350', '#527864', '#697d9c', '#a27686']
export function BookCover({ book, small = false }: { book: Book; small?: boolean }) {
  const category = book.category || '精选'
  return <div className={`book-cover wordbook-cover ${small ? 'book-cover-small' : ''}`} style={{ '--cover': (/^#[0-9a-f]{6}$/i.test(book.color) ? book.color : coverColors[(book.id - 1) % coverColors.length]) } as CSSProperties} aria-hidden="true"><div className="book-cover-top">就背单词</div><div className="book-cover-type">{category}</div><div className="book-cover-title">{book.title.replace(/精选|词汇|核心|高频/g, '').trim()}</div><div className="cover-lines"><i /><i /><i /></div><div className="book-cover-bottom">VOCABULARY <span>↗</span></div></div>
}
export function BookCard({ book, onOpen, selected }: { book: Book; onOpen: () => void; selected?: boolean }) {
  const progress = book.wordCount ? Math.round(book.learnedCount / book.wordCount * 100) : 0
  return <Card className="library-book library-card"><button type="button" className="cover-trigger" onClick={onOpen} aria-label={`查看${book.title}`}><BookCover book={book} /></button><Card.Header><div className="library-card-title"><Card.Title>{book.title}</Card.Title>{selected && <Chip size="sm" color="success" variant="soft">在学</Chip>}</div><Card.Description>{book.subtitle}</Card.Description></Card.Header><Card.Content><div className="learning-progress-copy"><span>已掌握 {book.learnedCount} / {book.wordCount}</span><strong>{progress}%</strong></div><Progress label={`${book.title}掌握进度`} value={progress} /></Card.Content><Card.Footer><span className="library-card-note">{book.dueCount > 0 ? `${book.dueCount} 词待复习` : book.wordCount > 0 && book.learnedCount === book.wordCount ? '已全部掌握' : `${book.wordCount} 个单词`}</span><Button size="sm" variant="ghost" onPress={onOpen}>查看词书 <span aria-hidden="true">↗</span></Button></Card.Footer></Card>
}
