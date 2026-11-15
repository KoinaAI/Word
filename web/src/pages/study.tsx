import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowLeft, ArrowRight, ArrowRotateLeft, BookOpen, Check, Volume } from '@gravity-ui/icons'
import { Button, Card } from '@heroui/react'
import { Empty, Failure, IconButton, Loading, Progress } from '@/components/shared'
import { ApiError, api, json, useUser } from '@/lib/api'
import { pronounce, stopPronunciation } from '@/lib/speech'
import { completeStudyAnswer, createStudyEventId, createStudyRound, studyAnswer, summarizeStudyRound } from '@/lib/study-flow'
import type { StudyDecision } from '@/lib/study-flow'
import type { Answer, Mode, Study } from '@/lib/types'

const modeLabels: Record<Mode, string> = { learn: '日常学习', review: '记忆复习', sprint: '临考速刷', reinforce: '重点巩固' }
const modeDescriptions: Record<Mode, string> = {
  learn: '先回想，再看释义。记住的单词会进入复习计划。',
  review: '在记忆变淡之前，再把它拾起来。',
  sprint: '只为还没掌握的单词停留。',
  reinforce: '给刚刚模糊的记忆，再一次确定的机会。',
}
type Submission = { wordId: number; mode: Mode; answer: Answer; eventId: string }
type Transaction = { payload: Submission; phase: 'sending' | 'failed' | 'settled' }

export function StudyPage() {
  const { bookId: rawBookId, mode: rawMode } = useParams()
  const navigate = useNavigate()
  const user = useUser()
  const bookId = Number(rawBookId)
  const mode = rawMode as Mode
  if (!Number.isSafeInteger(bookId) || bookId < 1 || !Object.hasOwn(modeLabels, mode)) {
    return <div className="mx-auto max-w-xl px-6 py-20"><Empty title="没有找到这个学习页面" description="从词书中选择一个学习模式，重新开始吧。" action={<Button onPress={() => navigate('/books')}>选择词书</Button>} /></div>
  }
  if (user.isPending) return <Loading label="正在连接你的学习记录" />
  if (user.error || !user.data) return <Failure error={user.error} retry={user.refetch} />
  return <StudyLoader key={`${user.data.id}:${bookId}:${mode}`} bookId={bookId} mode={mode} userId={user.data.id} />
}

function StudyLoader({ bookId, mode, userId }: { bookId: number; mode: Mode; userId: number }) {
  const navigate = useNavigate()
  const [generation, setGeneration] = useState(0)
  const [sessionId] = useState(() => createStudyEventId())
  const study = useQuery({
    queryKey: ['study', userId, bookId, mode, sessionId, generation],
    queryFn: ({ signal }) => api<Study>(`/study?bookId=${bookId}&mode=${mode}`, { signal }),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  })
  const exit = () => navigate(`/books/${bookId}`)
  if (study.isPending || study.error || !study.data) {
    return <div className="min-h-dvh bg-background px-6"><div className="mx-auto max-w-5xl py-6"><Button variant="ghost" onPress={exit}><ArrowLeft />返回词书</Button></div>{study.isPending ? <Loading label="正在准备本轮单词" /> : <Failure error={study.error} retry={study.refetch} />}</div>
  }
  return <StudySession key={generation} initialStudy={study.data} mode={mode} exit={exit} reload={() => setGeneration(value => value + 1)} />
}

function StudySession({ initialStudy, mode, exit, reload }: { initialStudy: Study; mode: Mode; exit: () => void; reload: () => void }) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const reduceMotion = useReducedMotion()
  const [book] = useState(() => ({ ...initialStudy.book }))
  const [round, setRound] = useState(() => createStudyRound(initialStudy.words))
  const [revealed, setRevealed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const [failure, setFailure] = useState<Error | null>(null)
  const [reinforcedIds, setReinforcedIds] = useState(() => new Set<number>())
  const transaction = useRef<Transaction | null>(null)
  const revealedRef = useRef(false)
  const mounted = useRef(true)
  const word = round.words[round.cursor]
  const displayedWordId = useRef(word?.id)
  const summary = summarizeStudyRound(round)
  const isSprint = mode === 'sprint'
  const terminalFailure = failure instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(failure.status)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (word && localStorage.getItem('word-auto-audio') === 'true') pronounce(word.text)
    return stopPronunciation
  }, [word?.id])

  // Keep the lock through the outgoing animation; the next card unlocks only after it is visible.
  useLayoutEffect(() => {
    displayedWordId.current = word?.id
    if ((!word || reduceMotion) && transaction.current?.phase === 'settled') {
      transaction.current = null
      setTransitioning(false)
    }
  }, [word, reduceMotion])

  function unlockVisibleWord(wordId: number) {
    if (displayedWordId.current !== wordId || transaction.current?.phase !== 'settled') return
    transaction.current = null
    setTransitioning(false)
  }

  function revealMeaning() {
    if (!word || transaction.current || revealedRef.current) return
    revealedRef.current = true
    setRevealed(true)
  }

  async function send(payload: Submission) {
    transaction.current = { payload, phase: 'sending' }
    setSaving(true)
    setFailure(null)
    try {
      await api<{ ok: true }>('/study/answer', json('POST', payload))
      for (const queryKey of ['stats', 'books', 'favorites', 'admin', 'study']) {
        void client.invalidateQueries({ queryKey: [queryKey], refetchType: 'none' })
      }
      if (!mounted.current) return
      transaction.current = { payload, phase: 'settled' }
      setTransitioning(true)
      setRound(current => completeStudyAnswer(current, payload.wordId, payload.answer))
      if (payload.answer === 'unsure-known') setReinforcedIds(current => new Set([...current, payload.wordId]))
      revealedRef.current = false
      setRevealed(false)
      setSaving(false)
    } catch (error) {
      if (!mounted.current) return
      transaction.current = { payload, phase: 'failed' }
      setFailure(error instanceof Error ? error : new Error('网络暂时不可用，请重试。'))
      setSaving(false)
    }
  }

  function choose(decision: StudyDecision) {
    if (!word || transaction.current) return
    const answer = studyAnswer(mode, revealedRef.current, decision)
    if (!answer) return
    void send({ wordId: word.id, mode, answer, eventId: createStudyEventId() })
  }

  function retryAnswer() {
    const failed = transaction.current
    if (failed?.phase !== 'failed') return
    // A lost response may already have been committed; reuse the exact decision and event ID.
    void send(failed.payload)
  }

  function retryUnknown() {
    if (!isSprint || transaction.current || !summary.unknown.length) return
    revealedRef.current = false
    setRevealed(false)
    setRound(createStudyRound(summary.unknown, round.number + 1))
  }

  useEffect(() => {
    if (!word) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        if (['1', '2', '3', ' ', 'Enter'].includes(event.key)) event.preventDefault()
        return
      }
      if (event.isComposing || event.altKey || event.metaKey || event.ctrlKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return
      if (transaction.current) return
      if (event.code === 'Space') {
        if (target?.closest('button, a, [role="button"]')) return
        event.preventDefault()
        if (!isSprint && !revealedRef.current) revealMeaning()
        else pronounce(word.text)
      } else if (event.key === '1') {
        event.preventDefault()
        choose('unknown')
      } else if (event.key === '2' && isSprint) {
        event.preventDefault()
        revealMeaning()
      } else if (event.key === '3') {
        event.preventDefault()
        choose('known')
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  })

  const header = <header className="mx-auto w-full max-w-5xl px-5 pt-5 sm:px-8 sm:pt-7"><div className="flex items-center justify-between gap-3"><Button variant="ghost" onPress={exit} isDisabled={saving} className="shrink-0"><ArrowLeft /><span className="hidden sm:inline">结束学习</span><span className="sm:hidden">返回</span></Button><div className="min-w-0 text-center"><p className="truncate text-sm font-medium">{book.title}</p><p className="mt-1 text-xs text-muted">{modeLabels[mode]}{round.number > 1 ? ` · 第 ${round.number} 轮` : ''}</p></div><span className="min-w-16 text-right text-sm text-muted tabular-nums" aria-label={`已完成 ${round.cursor} 个，共 ${round.words.length} 个`}>{round.cursor}<span className="mx-1 opacity-50">/</span>{round.words.length}</span></div><Progress label="本轮学习进度" value={round.words.length ? round.cursor / round.words.length * 100 : 0} className="mt-5" /></header>

  if (!round.words.length) {
    const content = mode === 'review'
      ? { title: '这一刻，没有到期的复习', description: '下次到期时，单词会自动回到复习列表。现在可以学几个新词。' }
      : mode === 'reinforce'
        ? { title: '巩固列表已经清空', description: '速刷中看过释义后选择“会”的单词，会收进这里。' }
        : mode === 'sprint'
          ? { title: '这一轮，可以轻松收尾了', description: '当前没有待速刷单词。已掌握的单词会按计划复习，模糊的单词可继续巩固。' }
          : { title: '本书的新词已学完', description: '记得回来复习，让短暂的熟悉变成长期的记忆。' }
    return <div className="min-h-dvh bg-background">{header}<main className="mx-auto flex min-h-[70dvh] max-w-lg items-center px-6"><Empty {...content} action={<div className="flex flex-wrap justify-center gap-3"><Button variant="outline" onPress={exit}>返回词书</Button><Button onPress={() => navigate(`/study/${book.id}/${mode === 'sprint' ? 'reinforce' : mode === 'review' ? 'learn' : 'review'}`)}>{mode === 'sprint' ? '查看巩固列表' : mode === 'review' ? '学习新词' : '查看复习'}<ArrowRight /></Button></div>} /></main></div>
  }

  if (!word) {
    return <div className="min-h-dvh bg-background">{header}<main className="mx-auto flex min-h-[75dvh] max-w-2xl flex-col items-center justify-center px-6 py-12 text-center"><motion.div initial={reduceMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }} className="w-full"><div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-full bg-success/10 text-success"><Check className="size-7" /></div><p className="text-xs tracking-wide text-muted">一点积累，一点进步</p><h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">这一轮，完成了。</h1><p className="mt-4 text-sm leading-6 text-muted">已完成 {round.results.length} 个单词的判断，学习记录已保存。</p><div className={`mt-9 grid gap-4 ${isSprint ? 'grid-cols-3' : 'grid-cols-2'}`}><SummaryCount label={isSprint ? '直接掌握' : '记住了'} value={summary.known} />{isSprint && <SummaryCount label="加入巩固" value={summary.reinforce} />}<SummaryCount label={isSprint ? '留待再刷' : mode === 'reinforce' ? '返回新词' : '需要再记'} value={summary.unknown.length} /></div><p className="mx-auto mt-6 max-w-md text-sm leading-6 text-muted">{isSprint ? '会的已标记掌握，模糊的已加入巩固，不会的继续留在速刷列表。' : mode === 'reinforce' ? '记住的已移出巩固；仍不会的回到新词列表，重新打好基础。' : '记住的会按间隔复习；暂时不会的，10 分钟后再见一次。'}</p><div className="mt-8 flex flex-wrap justify-center gap-3">{isSprint && summary.unknown.length > 0 && <Button onPress={retryUnknown}><ArrowRotateLeft />再刷不会的 {summary.unknown.length} 词</Button>}{isSprint && <Button variant={summary.unknown.length ? 'outline' : 'primary'} onPress={() => navigate(`/study/${book.id}/reinforce`)}>去巩固{reinforcedIds.size ? ` ${reinforcedIds.size} 词` : ''}<ArrowRight /></Button>}{mode === 'learn' && <Button onPress={reload}>再学一组<ArrowRight /></Button>}{mode === 'reinforce' && summary.unknown.length > 0 && <Button onPress={() => navigate(`/study/${book.id}/sprint`)}>回到速刷<ArrowRight /></Button>}<Button variant="outline" onPress={exit}><BookOpen />返回词书</Button></div></motion.div></main></div>
  }

  return <div className="min-h-dvh bg-background">{header}<main className="mx-auto flex min-h-[calc(100dvh-7.5rem)] w-full max-w-3xl flex-col px-5 pb-7 sm:px-8 sm:pb-10"><div className="flex flex-1 flex-col justify-center pt-9 sm:pt-12"><AnimatePresence mode="wait" initial={false}><motion.section key={`${round.number}:${word.id}`} aria-label="当前单词" className="text-center" initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -5 }} transition={{ duration: 0.12 }} onAnimationComplete={() => unlockVisibleWord(word.id)}><h1 className="break-words text-[clamp(2.5rem,8vw,5rem)] font-semibold leading-tight tracking-[-0.045em]" lang="en" aria-live="polite">{word.text}</h1><div className="mt-4 flex items-center justify-center gap-2"><span className="text-lg text-muted" lang="en">{word.phonetic || '音标暂缺'}</span><IconButton label="播放单词发音（空格）" onPress={() => pronounce(word.text)}><Volume className="size-5" /></IconButton></div><div className="min-h-44 pt-8 sm:min-h-48 sm:pt-10">{revealed && <motion.div initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}><p className="text-xl font-medium leading-relaxed" aria-live="polite">{word.meaning}</p>{!isSprint && word.example && <div className="mx-auto mt-5 max-w-lg"><p className="text-base leading-7 text-muted" lang="en">{word.example}</p>{word.exampleMeaning && <p className="mt-1 text-sm leading-6 text-muted/80">{word.exampleMeaning}</p>}</div>}</motion.div>}</div></motion.section></AnimatePresence></div><div className="mx-auto w-full max-w-xl pt-5"><div className="mb-5 flex min-h-6 items-center justify-center text-center text-xs leading-5 text-muted">{revealed && isSprint ? '看过释义后选择“会”，会加入巩固列表。' : !isSprint && !revealed ? modeDescriptions[mode] : <span aria-hidden="true">&nbsp;</span>}</div>{failure ? <Card className="p-5" role="alert"><Card.Header className="gap-2"><Card.Title>{terminalFailure ? '学习队列发生了变化' : '这次选择还没有确认'}</Card.Title><Card.Description>{failure.message}{!terminalFailure && ' 重试会提交同一次选择，请先确认这次结果。'}</Card.Description></Card.Header><Card.Footer className="flex-wrap gap-3">{terminalFailure ? <Button onPress={failure instanceof ApiError && failure.status === 401 ? () => navigate('/login') : reload}>{failure instanceof ApiError && failure.status === 401 ? '重新登录' : '刷新学习队列'}</Button> : <Button onPress={retryAnswer} isPending={saving}><ArrowRotateLeft />重试这次选择</Button>}<Button variant="outline" onPress={exit} isDisabled={saving}>返回词书</Button></Card.Footer></Card> : !isSprint && !revealed ? <Button className="h-14 w-full" onPress={revealMeaning} isDisabled={transitioning} aria-keyshortcuts="Space">查看释义<span className="ml-3 hidden rounded bg-accent-foreground/15 px-1.5 py-0.5 text-[10px] sm:inline" aria-hidden="true">Space</span></Button> : <div className={`grid gap-3 ${isSprint && !revealed ? 'grid-cols-3' : 'grid-cols-2'}`}><Button variant="secondary" className="h-14" onPress={() => choose('unknown')} isDisabled={saving || transitioning} aria-keyshortcuts="1">不会<KeyHint value="1" /></Button>{isSprint && !revealed && <Button variant="outline" className="h-14" onPress={revealMeaning} isDisabled={saving || transitioning} aria-keyshortcuts="2">不确定<KeyHint value="2" /></Button>}<Button className="h-14" onPress={() => choose('known')} isDisabled={saving || transitioning} aria-keyshortcuts="3">会<KeyHint value="3" /></Button></div>}<div className="mt-5 min-h-5 text-center text-xs text-muted/70" role="status" aria-live="polite">{saving ? '正在保存这次选择…' : failure ? '确认结果前，当前单词会保持在这里。' : <span className="hidden sm:inline">{isSprint ? (revealed ? '1 不会 · 3 会 · 空格发音' : '1 不会 · 2 不确定 · 3 会 · 空格发音') : revealed ? '1 不会 · 3 会 · 空格发音' : '空格查看释义，先给回想一点时间'}</span>}</div></div></main></div>
}

function KeyHint({ value }: { value: string }) {
  return <kbd className="ml-2 hidden rounded bg-current/5 px-1.5 py-0.5 text-[10px] font-normal opacity-55 sm:inline" aria-hidden="true">{value}</kbd>
}
function SummaryCount({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl bg-surface-secondary px-3 py-5"><strong className="block text-3xl font-semibold tracking-tight tabular-nums">{value}</strong><span className="mt-2 block text-xs text-muted">{label}</span></div>
}
