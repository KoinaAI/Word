import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowLeft, ArrowRight, ArrowRotateLeft, BookOpen, Check, ChevronDown, ChevronUp, Star, Volume, Xmark } from '@gravity-ui/icons'
import { Button, Card, Input, TextField } from '@heroui/react'
import { Empty, Failure, IconButton, Loading, Progress } from '@/components/shared'
import { ApiError, api, getSessionEpoch, json, useUser } from '@/lib/api'
import { enqueueFavoriteMutation, readFavoriteIntent } from '@/lib/favorite-mutations'
import { saveFavoriteCAS } from '@/lib/favorite-request'
import { pronounce, stopPronunciation } from '@/lib/speech'
import { completeStudyAnswer, createStudyEventId, createStudyRound, studyAnswer, summarizeStudyRound, undoStudyAnswer } from '@/lib/study-flow'
import type { StudyDecision } from '@/lib/study-flow'
import type { Answer, Book, Mode, Study, User, Word } from '@/lib/types'
import { advanceQuizRound, createQuizRound, isCorrectSpelling, quizProgress, recordQuizAnswer, summarizeQuizRound } from '@/lib/study-quiz'
import type { QuizRound } from '@/lib/study-quiz'
import { advanceLearnRound, createLearnRound, isLearnAnswerResponse, learnProgress, recordLearnAnswer, summarizeLearnRound } from '@/lib/learn-round'
import type { LearnAnswerResponse, LearnRound } from '@/lib/learn-round'
import { toast } from 'sonner'
import './study.css'

const modeLabels: Record<Mode, string> = { learn: '日常学习', review: '记忆复习', sprint: '临考速刷', reinforce: '重点巩固' }
type Submission = { wordId: number; mode: Mode; answer: Answer; eventId: string; contentVersion?: number; learnStage?: 0 | 1; learnRevision?: number }
type Transaction = { payload: Submission; phase: 'sending' | 'failed' | 'settled' }
type StudyBatch = Study & { hasMore?: boolean; nextAfter?: number; vocabulary?: Word[] }
type PendingAnswer = { kind: 'answer'; payload: Submission; savedAt: number } | { kind: 'undo'; eventId: string; savedAt: number }

function readPendingAnswer(key: string): PendingAnswer | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null') as PendingAnswer | null
    if (value?.kind === 'undo') return typeof value.eventId === 'string' ? value : null
    return value?.kind === 'answer' && typeof value.payload?.eventId === 'string' && Number.isSafeInteger(value.payload.wordId) ? value : null
  } catch { return null }
}

function rememberAnswer(key: string, payload: Submission) {
  try { sessionStorage.setItem(key, JSON.stringify({ kind: 'answer', payload, savedAt: Date.now() })) } catch { /* The in-memory transaction still supports retry when storage is unavailable. */ }
}

function rememberUndo(key: string, eventId: string) {
  try { sessionStorage.setItem(key, JSON.stringify({ kind: 'undo', eventId, savedAt: Date.now() })) } catch { /* An in-memory unknown result still locks subsequent judgments. */ }
}

function forgetAnswer(key: string) {
  try { sessionStorage.removeItem(key) } catch { /* Restricted storage must not prevent a confirmed answer from advancing. */ }
}

function updateFavoriteCache(value: unknown, wordId: number, favorite: boolean): unknown {
  if (Array.isArray(value)) return value.map(item => item && typeof item === 'object' && 'bookId' in item && item.id === wordId ? { ...item, favorite } : item)
  if (value && typeof value === 'object') {
    const result = { ...value } as Record<string, unknown>
    if (Array.isArray(result.words)) result.words = updateFavoriteCache(result.words, wordId, favorite)
    if (Array.isArray(result.vocabulary)) result.vocabulary = updateFavoriteCache(result.vocabulary, wordId, favorite)
    if (Array.isArray(result.items)) result.items = updateFavoriteCache(result.items, wordId, favorite)
    return result
  }
  return value
}

function isLearnRound(round: QuizRound | LearnRound): round is LearnRound {
  return 'kind' in round && round.kind === 'learn'
}

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
  const client = useQueryClient()
  const [generation, setGeneration] = useState(0)
  const [after, setAfter] = useState(0)
  const [sessionId] = useState(() => createStudyEventId())
  const pendingKey = `word-pending-answer:${userId}:${bookId}:${mode}`
  const [pending, setPending] = useState(() => readPendingAnswer(pendingKey))
  const [confirming, setConfirming] = useState(false)
  const [recoveryError, setRecoveryError] = useState<Error | null>(null)
  const recoveryRequest = useRef<AbortController | null>(null)
  const study = useQuery({
    queryKey: ['study', userId, bookId, mode, sessionId, generation, after],
    queryFn: ({ signal }) => api<StudyBatch>(`/study?bookId=${bookId}&mode=${mode}&limit=100&after=${after}`, { signal }),
    enabled: !pending,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  })
  useEffect(() => () => recoveryRequest.current?.abort(), [])
  const exit = () => { recoveryRequest.current?.abort(); navigate(`/books/${bookId}`) }
  const reload = () => { forgetAnswer(pendingKey); setAfter(0); setGeneration(value => value + 1) }
  const nextBatch = () => { setAfter(mode === 'learn' ? 0 : study.data?.nextAfter || 0); setGeneration(value => value + 1) }
  const resume = () => { forgetAnswer(pendingKey); setPending(null); reload() }
  const confirmPending = async () => {
    if (!pending || confirming) return
    const controller = new AbortController()
    recoveryRequest.current = controller
    setConfirming(true); setRecoveryError(null)
    try {
      await api(pending.kind === 'undo' ? '/study/answer/undo' : '/study/answer', { ...json('POST', pending.kind === 'undo' ? { eventId: pending.eventId } : pending.payload), signal: controller.signal })
      for (const queryKey of ['study', 'books', 'stats', 'admin']) void client.invalidateQueries({ queryKey: [queryKey], refetchType: 'none' })
      resume()
    } catch (error) { if (!controller.signal.aborted) setRecoveryError(error instanceof Error ? error : new Error('暂时无法确认，请重试。')) }
    finally { if (!controller.signal.aborted) setConfirming(false) }
  }
  if (pending) return <div className="study-recovery"><Card><Card.Header><Card.Title>{pending.kind === 'undo' ? '上次的撤销尚未确认' : '上次的选择尚未确认'}</Card.Title><Card.Description>退出或网络中断时，服务器可能已经保存。先确认同一次操作，再按当前进度继续。</Card.Description></Card.Header><Card.Content>{recoveryError && <p role="alert" className="text-danger">{recoveryError.message}</p>}</Card.Content><Card.Footer className="flex-wrap gap-3"><Button isPending={confirming} onPress={() => { void confirmPending() }}>确认上次操作</Button>{recoveryError instanceof ApiError && [400, 404, 409, 422].includes(recoveryError.status) && <Button variant="secondary" onPress={resume}>按当前进度继续</Button>}<Button variant="outline" onPress={exit}>返回词书</Button></Card.Footer></Card></div>
  const loading = study.isPending
  const error = study.error
  if (loading || error || !study.data) {
    return <div className="min-h-dvh bg-background px-6"><div className="mx-auto max-w-5xl py-6"><Button variant="ghost" onPress={exit}><ArrowLeft />返回词书</Button></div>{loading ? <Loading label="正在准备本轮单词" /> : <Failure error={error} retry={study.refetch} />}</div>
  }
  return mode === 'sprint'
    ? <SprintSession key={generation} initialStudy={study.data} pendingKey={pendingKey} mode={mode} exit={exit} reload={reload} nextBatch={nextBatch} />
    : <QuizSession key={generation} initialStudy={study.data} vocabulary={study.data.vocabulary || study.data.words} pendingKey={pendingKey} userId={userId} mode={mode} exit={exit} reload={reload} nextBatch={nextBatch} />
}

type QuizFeedback = { correct: boolean; selectedId?: number; spelling?: string }
type QuizTransaction = { payload: Submission; questionKey: string; correct: boolean }

function QuizSession({ initialStudy, vocabulary, pendingKey, userId, mode, exit, reload, nextBatch }: { initialStudy: StudyBatch; vocabulary: Word[]; pendingKey: string; userId: number; mode: Mode; exit: () => void; reload: () => void; nextBatch: () => void }) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const reduceMotion = useReducedMotion()
  const [round, setRound] = useState<QuizRound | LearnRound>(() => mode === 'learn' ? createLearnRound(initialStudy.words, vocabulary) : createQuizRound(initialStudy.words, vocabulary))
  const [feedback, setFeedback] = useState<QuizFeedback | null>(null)
  const [spelling, setSpelling] = useState('')
  const [showOptions, setShowOptions] = useState(false)
  const [recapExpanded, setRecapExpanded] = useState(false)
  const [favoriteIds, setFavoriteIds] = useState(() => new Set(initialStudy.words.filter(word => word.favorite).map(word => word.id)))
  const [pendingFavoriteIds, setPendingFavoriteIds] = useState<Set<number>>(() => new Set())
  const favoriteRequests = useRef(new Set<number>())
  const [saving, setSaving] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const [failure, setFailure] = useState<Error | null>(null)
  const transaction = useRef<(QuizTransaction & { phase: 'sending' | 'failed' }) | null>(null)
  const locked = useRef(false)
  const moving = useRef(false)
  const mounted = useRef(true)
  const questionElement = useRef<HTMLElement | null>(null)
  const spellingElement = useRef<HTMLInputElement | null>(null)
  const answerRequest = useRef<AbortController | null>(null)
  const optionsId = useId()
  const question = round.questions[round.cursor]
  const learnQuestion = isLearnRound(round) ? round.questions[round.cursor] : undefined
  const displayedKey = useRef(question?.key)
  const summary = summarizeQuizRound(round)
  const learningSummary = isLearnRound(round) ? summarizeLearnRound(round) : null
  const progress = isLearnRound(round) ? learnProgress(round) : quizProgress(round)
  const mistakeWords = learningSummary ? learningSummary.mistakes : round.questions.filter(item => !item.correction && round.results.some(result => result.key === item.key && !result.correct)).map(item => item.word)
  const terminalFailure = failure instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(failure.status)
  const audioAllowed = !!question && (question.direction === 'en-zh' || !!feedback)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; answerRequest.current?.abort() }
  }, [])

  useEffect(() => {
    // Reading a Chinese prompt aloud would disclose the answer before the learner has chosen.
    if (question && audioAllowed && localStorage.getItem('word-auto-audio') === 'true') pronounce(question.word.text)
    return stopPronunciation
  }, [question?.key, audioAllowed])

  useLayoutEffect(() => {
    displayedKey.current = question?.key
    if (moving.current) {
      if (question?.kind !== 'typing') questionElement.current?.focus({ preventScroll: true })
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
    if (!question || reduceMotion) unlockQuestion(question?.key)
  }, [question?.key, reduceMotion])

  useLayoutEffect(() => {
    if (question?.kind === 'typing' && !transitioning && !feedback) spellingElement.current?.focus({ preventScroll: true })
  }, [question?.key, transitioning, !!feedback])

  function unlockQuestion(key: string | undefined) {
    if (displayedKey.current !== key || !moving.current) return
    moving.current = false
    locked.current = false
    setTransitioning(false)
  }

  async function saveAnswer(pending: QuizTransaction) {
    if (transaction.current?.phase === 'sending') return
    transaction.current = { ...pending, phase: 'sending' }
    rememberAnswer(pendingKey, pending.payload)
    const controller = new AbortController()
    answerRequest.current = controller
    setSaving(true)
    setFailure(null)
    try {
      const response = await api<{ ok: true } | LearnAnswerResponse>('/study/answer', { ...json('POST', pending.payload), signal: controller.signal })
      forgetAnswer(pendingKey)
      for (const queryKey of ['stats', 'books', 'favorites', 'admin', 'study']) {
        void client.invalidateQueries({ queryKey: [queryKey], refetchType: 'none' })
      }
      if (!mounted.current) return
      if (isLearnRound(round)) {
        const currentQuestion = round.questions[round.cursor]
        if (!currentQuestion || !isLearnAnswerResponse(currentQuestion, pending.correct, response)) throw new ApiError('学习阶段未确认，请刷新当前队列。', 409)
        const next = recordLearnAnswer(round, pending.questionKey, pending.correct, response, vocabulary)
        if (next === round) throw new ApiError('学习阶段已变化，请刷新当前队列。', 409)
        setRound(next)
      } else {
        setRound(current => recordQuizAnswer(current, pending.questionKey, pending.correct, vocabulary))
      }
      transaction.current = null
      setSaving(false)
    } catch (error) {
      if (!mounted.current) return
      transaction.current = { ...pending, phase: 'failed' }
      setFailure(error instanceof Error ? error : new Error('网络暂时不可用，请重试。'))
      setSaving(false)
    }
  }

  function answerQuiz(choice: QuizFeedback) {
    if (!question || locked.current) return
    locked.current = true
    setFeedback(choice)
    if (mode !== 'learn' && question.correction) {
      // The first answer already schedules review. Local correction must not extend that interval.
      setRound(current => recordQuizAnswer(current, question.key, choice.correct, vocabulary))
      return
    }
    void saveAnswer({
      questionKey: question.key,
      correct: choice.correct,
      payload: { wordId: question.word.id, mode, answer: choice.correct ? 'known' : 'unknown', eventId: createStudyEventId(), contentVersion: (question.word as Word & { contentVersion?: number }).contentVersion, ...(learnQuestion ? { learnStage: learnQuestion.learnStage, learnRevision: learnQuestion.learnRevision } : {}) },
    })
  }

  function nextQuestion() {
    if (!question || !feedback || saving || failure || moving.current || !round.results.some(result => result.key === question.key)) return
    moving.current = true
    setTransitioning(true)
    setRound(current => isLearnRound(current) ? advanceLearnRound(current) : advanceQuizRound(current))
    setFeedback(null)
    setSpelling('')
    setShowOptions(false)
  }

  async function toggleFavorite(wordId: number) {
    // The same word can reappear in correction practice while its first request is pending.
    if (favoriteRequests.current.has(wordId)) return
    const epoch = getSessionEpoch()
    const favorite = !readFavoriteIntent(client, userId, wordId, epoch, favoriteIds.has(wordId))
    const isCurrent = () => getSessionEpoch() === epoch && client.getQueryData<User>(['me'])?.id === userId
    const mutation = enqueueFavoriteMutation({
      scope: client, userId, wordId, epoch, favorite,
      isCurrent,
      send: nextFavorite => saveFavoriteCAS(api, wordId, nextFavorite, isCurrent),
    })
    favoriteRequests.current.add(wordId)
    setPendingFavoriteIds(new Set(favoriteRequests.current))
    try {
      const result = await mutation.result
      if (!mutation.isLatest() || result.cancelled) return
      if (!result.saved) {
        if (mounted.current) toast.error(result.error instanceof Error ? result.error.message : '收藏暂时没有保存成功')
        return
      }
      for (const queryKey of ['study', 'books', 'favorites']) client.setQueriesData({ queryKey: [queryKey] }, data => updateFavoriteCache(data, wordId, favorite))
      for (const queryKey of ['favorites', 'books', 'stats']) void client.invalidateQueries({ queryKey: [queryKey], refetchType: 'none' })
      if (mounted.current) setFavoriteIds(current => { const next = new Set(current); if (favorite) next.add(wordId); else next.delete(wordId); return next })
    } finally {
      mutation.release()
      favoriteRequests.current.delete(wordId)
      if (mounted.current) setPendingFavoriteIds(new Set(favoriteRequests.current))
    }
  }

  useEffect(() => {
    if (!question) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.altKey || event.metaKey || event.ctrlKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return
      if (event.repeat) {
        if (['1', '2', '3', '4', 'f', 'F', ' ', 'Enter'].includes(event.key)) event.preventDefault()
        return
      }
      if (event.key.toLowerCase() === 'f') {
        if (audioAllowed && !moving.current) {
          event.preventDefault()
          pronounce(question.word.text)
        }
        return
      }
      if (event.key === 'Enter' && feedback && !failure) {
        if (target?.closest('button, a, [role="button"]')) return
        event.preventDefault()
        event.stopPropagation()
        nextQuestion()
      } else if (/^[1-4]$/.test(event.key) && question.kind === 'choice') {
        const option = question.options[Number(event.key) - 1]
        if (!option) return
        event.preventDefault()
        answerQuiz({ correct: option.id === question.word.id, selectedId: option.id })
      }
      // Space keeps native button activation. It never reveals or plays audio in a quiz.
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  })

  const header = <StudyHeader book={initialStudy.book} mode={mode} exit={exit} saving={saving} completed={progress.completed} total={progress.total} unit={mode === 'learn' ? '词' : '题'} detail={mode === 'learn' ? initialStudy.hasMore ? '分组完成 · 两步记牢' : '两步记牢' : progress.phase === 'correction' ? '错词再练' : progress.phase === 'complete' ? '本轮完成' : '双向练习'} />
  if (!round.wordCount) {
    return <div className="study-page">{header}<main className="study-complete"><Empty title={mode === 'review' ? '暂时没有到期的复习' : mode === 'reinforce' ? '巩固列表已经清空' : '这本词书的新词已学完'} description={mode === 'reinforce' ? '速刷中看过释义后选择“会”的词，会在这里做双向练习。' : '选择其他词书，或等下次复习到期后再来。'} action={<Button variant="outline" onPress={exit}>返回词书</Button>} /></main></div>
  }
  if (!question) {
    return <div className="study-page">{header}<main className="study-complete">
      <div className="study-complete-icon"><Check /></div>
      <p className="text-sm text-muted">{modeLabels[mode]}已完成</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">{learningSummary ? '每个词，都多记住了一遍。' : '记住一点，再前进一点。'}</h1>
      <p className="mt-4 text-sm leading-6 text-muted">{learningSummary ? `${round.wordCount} 个单词均已通过英译中与中译英。` : `本轮学习 ${round.wordCount} 个单词，首次答对 ${summary.correct} 个。`}</p>
      <div className="study-summary">{learningSummary ? <><SummaryCount label="完成单词" value={learningSummary.completed} /><SummaryCount label="本轮作答" value={learningSummary.attempts} /><SummaryCount label="重新练过" value={learningSummary.restartedWords} /></> : <><SummaryCount label="首次答对" value={summary.correct} /><SummaryCount label="需要再记" value={summary.mistakes} />{summary.correctionCount > 0 && <SummaryCount label="纠错答对" value={summary.corrected} />}</>}</div>
      <p className="mt-6 max-w-md text-sm leading-6 text-muted">{learningSummary ? `完成两步的单词已加入间隔复习计划。${learningSummary.restartedWords ? '错过的词也从第一步重新通过了。' : '下次到期时，再来回顾。'}` : summary.mistakes ? mode === 'reinforce' ? '首次答错的词已返回新词列表，方便重新打好基础。' : '首次答错的词已安排短间隔复习，约 10 分钟后再见。' : '答对的单词已进入间隔复习计划。'}{!learningSummary && summary.correctionCount > 0 && ' 本轮纠错练习不重复计入学习次数。'}</p>
      {mistakeWords.length > 0 && <Card className="quiz-recap"><Card.Header><Card.Title>值得再看一遍</Card.Title><Card.Description>本轮重新练过的词，下次复习重点留意。</Card.Description></Card.Header><Card.Content><ul>{(recapExpanded ? mistakeWords : mistakeWords.slice(0, 5)).map(word => <li key={word.id}><div><strong lang="en">{word.text}</strong><p>{word.meaning}</p></div><IconButton label={`播放 ${word.text} 发音`} onPress={() => pronounce(word.text)}><Volume /></IconButton></li>)}</ul></Card.Content>{mistakeWords.length > 5 && <Card.Footer><Button fullWidth variant="ghost" onPress={() => setRecapExpanded(value => !value)}>{recapExpanded ? '收起列表' : `查看全部 ${mistakeWords.length} 个词`}{recapExpanded ? <ChevronUp /> : <ChevronDown />}</Button></Card.Footer>}</Card>}
      {initialStudy.hasMore && <p className="mt-4 text-sm text-muted">本组最多 100 词，剩余内容可以分组继续。</p>}
      <div className="mt-8 flex flex-wrap justify-center gap-3">{mode === 'learn' ? <Button onPress={reload}>{initialStudy.hasMore ? '继续下一组' : '再学一组'}<ArrowRight /></Button> : initialStudy.hasMore && <Button onPress={nextBatch}>继续下一组<ArrowRight /></Button>}{mode === 'reinforce' && summary.mistakes > 0 && <Button onPress={() => navigate(`/study/${initialStudy.book.id}/learn`)}>练习新词<ArrowRight /></Button>}<Button variant="outline" onPress={exit}><BookOpen />返回词书</Button></div>
    </main></div>
  }

  const selectedOption = feedback?.selectedId ? question.options.find(option => option.id === feedback.selectedId) : undefined
  const entersCorrection = mode !== 'learn' && round.cursor === round.wordCount - 1 && round.questions.length > round.wordCount
  const nextLabel = round.cursor === round.questions.length - 1 ? '查看本轮结果' : entersCorrection ? `再练 ${summary.mistakes} 个错词` : '下一题'
  const learningNote = learnQuestion && feedback ? !feedback.correct
    ? saving || failure ? '保存后，这个词将从第一步重新练习。' : '这个词已回到第一步，稍后重新练习。'
    : learnQuestion.learnStage === 0
      ? '词义认对了，接下来还要完成中译英。'
      : saving || failure ? '两步都答对了，保存成功后完成这个词。' : '两步都通过了，这个词已加入复习计划。'
    : null
  const answerOptions = question.kind === 'choice' && <div id={optionsId} className="quiz-options" role="group" aria-label="答案选项">{question.options.map((option, index) => {
    const correctOption = !!feedback && option.id === question.word.id
    const wrongOption = !!feedback && option.id === feedback.selectedId && !feedback.correct
    return <Button key={option.id} fullWidth variant="outline" className="quiz-option" data-answer={correctOption ? 'correct' : wrongOption ? 'wrong' : undefined} isDisabled={!!feedback || transitioning} onPress={() => answerQuiz({ correct: option.id === question.word.id, selectedId: option.id })} aria-keyshortcuts={String(index + 1)}><span className="quiz-option-number" aria-hidden="true">{index + 1}</span><span className="quiz-option-text" lang={question.direction === 'en-zh' ? 'zh-CN' : 'en'}>{option.label}</span>{correctOption ? <Check aria-label="正确答案" /> : wrongOption ? <Xmark aria-label="本次选择错误" /> : null}</Button>
  })}</div>

  return <div className="study-page">{header}<main className="quiz-main" data-answered={!!feedback}>
    <motion.section key={question.key} ref={questionElement} tabIndex={-1} aria-label="当前题目" className="quiz-question" initial={reduceMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.12 }} onAnimationComplete={() => unlockQuestion(question.key)}>
      {!feedback ? <>
        <div className="quiz-prompt">
          {learnQuestion && <LearnSteps stage={learnQuestion.learnStage} />}
          <span className="quiz-direction">{mode !== 'learn' && question.correction ? '错词再练 · ' : ''}{question.direction === 'en-zh' ? '英译中' : '中译英'}</span>
          <p className="quiz-instruction">{question.kind === 'typing' ? '写出本组词书中的对应英文' : question.direction === 'en-zh' ? '选择正确的中文释义' : '选择对应的英文单词'}</p>
          <h1 className={question.direction === 'en-zh' ? 'quiz-word' : 'quiz-meaning'} lang={question.direction === 'en-zh' ? 'en' : 'zh-CN'}>{question.direction === 'en-zh' ? question.word.text : question.word.meaning}</h1>
          {question.direction === 'en-zh' && <div className="study-pronunciation"><span lang="en">{question.word.phonetic || '音标暂缺'}</span><IconButton label="播放单词发音（F）" onPress={() => pronounce(question.word.text)} aria-keyshortcuts="F"><Volume /></IconButton></div>}
        </div>
        {question.kind === 'choice' ? answerOptions : <form className="quiz-spelling" onSubmit={event => { event.preventDefault(); if (spelling.trim()) answerQuiz({ correct: isCorrectSpelling(question, spelling), spelling: spelling.trim() }) }}><TextField aria-label="英文拼写" isDisabled={transitioning} value={spelling} onChange={setSpelling}><Input ref={spellingElement} fullWidth autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="输入英文单词" /></TextField><Button fullWidth type="submit" isDisabled={!spelling.trim() || transitioning}>确认答案<KeyHint value="Enter" /></Button><p className="quiz-spelling-hint">{question.spellingHint}{question.acceptedSpellings.length > 1 && ' 本组相同释义的词也可作答。'}</p></form>}
        <Button fullWidth variant="ghost" className="quiz-skip" isDisabled={transitioning} onPress={() => answerQuiz({ correct: false })}>想不起来，看看答案</Button>
        <p className="quiz-help">{question.kind === 'choice' ? `按 1–${question.options.length} 选择${audioAllowed ? ' · F 发音' : ''}` : '输入后按 Enter 确认'}</p>
      </> : <>
        <div className="quiz-feedback" data-correct={feedback.correct}>
          <div className="quiz-feedback-title" role="status" aria-live="polite">{feedback.correct ? <Check /> : <ArrowRotateLeft />}<strong>{feedback.correct ? learnQuestion ? learnQuestion.learnStage === 0 ? '词义认对了' : '英文也记住了' : question.correction ? '这次记住了' : '回答正确' : learnQuestion ? '从第一步，再记一次' : '再看一遍，加深印象'}</strong><span>{question.direction === 'en-zh' ? '英译中' : '中译英'}</span></div>
          <div className="quiz-feedback-heading"><h1 lang="en">{question.word.text}</h1><FavoriteWord favorite={favoriteIds.has(question.word.id)} pending={pendingFavoriteIds.has(question.word.id)} onPress={() => { void toggleFavorite(question.word.id) }} /></div>
          <div className="quiz-feedback-audio"><span lang="en">{question.word.phonetic}</span><IconButton label="播放单词发音（F）" onPress={() => pronounce(question.word.text)} aria-keyshortcuts="F"><Volume /></IconButton></div>
          <p className="quiz-feedback-meaning">{question.word.meaning}</p>
          {!feedback.correct && (selectedOption || feedback.spelling) && <p className="quiz-your-answer"><span>你的答案</span>{selectedOption?.label || feedback.spelling}</p>}
          {question.word.example && <div className="quiz-example"><span className="quiz-example-label">放进句子里记</span><p lang="en"><WordInContext text={question.word.example} word={question.word.text} /></p>{question.word.exampleMeaning && <p>{question.word.exampleMeaning}</p>}</div>}
          {learningNote ? <p className="quiz-correction-note">{learningNote}</p> : (!feedback.correct || question.correction) && <p className="quiz-correction-note">{question.correction ? '这次是本轮纠错练习，复习安排保持不变。' : saving || failure ? '保存后会加入本轮错词再练，稍后换个方向再试。' : '已加入本轮错词再练，稍后换个方向再试一次。'}</p>}
        </div>
        {question.kind === 'choice' && <><Button fullWidth variant="ghost" className="quiz-options-toggle" aria-expanded={showOptions} aria-controls={optionsId} onPress={() => setShowOptions(value => !value)}>{showOptions ? '收起本题选项' : '查看本题选项'}{showOptions ? <ChevronUp /> : <ChevronDown />}</Button>{showOptions && answerOptions}</>}
      </>}
    </motion.section>
    {failure ? <Card className="quiz-save-error" role="alert"><Card.Header><Card.Title>{terminalFailure ? '学习队列发生了变化' : '答案还没有保存成功'}</Card.Title><Card.Description>{failure.message}{!terminalFailure && ' 重试会保存同一次选择。'}</Card.Description></Card.Header><Card.Footer className="flex-wrap gap-3">{terminalFailure ? <Button onPress={failure instanceof ApiError && failure.status === 401 ? () => navigate('/login') : reload}>{failure instanceof ApiError && failure.status === 401 ? '重新登录' : '刷新学习队列'}</Button> : <Button isPending={saving} onPress={() => { if (transaction.current) void saveAnswer(transaction.current) }}>重试保存</Button>}<Button variant="outline" onPress={exit}>返回词书</Button></Card.Footer></Card> : feedback && <div className="quiz-next"><div className="quiz-next-inner"><div className="quiz-next-context"><strong>{learnQuestion ? '两步记牢' : question.correction ? '错词再练' : '本轮练习'}</strong><span>{progress.completed} / {progress.total} {learnQuestion ? '词已完成' : '已完成'}{entersCorrection ? ` · 接下来再练 ${summary.mistakes} 词` : ''}</span></div><Button fullWidth onPress={nextQuestion} isDisabled={saving || transitioning} isPending={saving} className="study-action" aria-keyshortcuts="Enter">{saving ? '正在保存，可随时退出' : nextLabel}<KeyHint value="Enter" /></Button></div></div>}
  </main></div>
}

function FavoriteWord({ favorite, pending, onPress }: { favorite: boolean; pending: boolean; onPress: () => void }) {
  return <IconButton label={favorite ? '取消收藏单词' : '收藏这个单词'} aria-pressed={favorite} isPending={pending} isDisabled={pending} className={favorite ? 'text-accent' : 'text-muted'} onPress={onPress}><Star fill={favorite ? 'currentColor' : 'none'} /></IconButton>
}

/** Highlight exact vocabulary matches without injecting imported example text as HTML. */
function WordInContext({ text, word }: { text: string; word: string }) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${escaped})(?![\\p{L}\\p{N}])`, 'giu')
  return text.split(pattern).map((part, index) => index % 2 ? <mark key={index}>{part}</mark> : part)
}

function StudyHeader({ book, mode, exit, completed, total, detail, unit = '题' }: { book: Book; mode: Mode; exit: () => void; saving: boolean; completed: number; total: number; detail?: string; unit?: string }) {
  return <header className="study-header"><div className="study-header-row"><Button variant="ghost" onPress={exit} className="study-exit"><ArrowLeft /><span>退出</span></Button><div className="study-header-title"><p>{book.title}</p><span>{modeLabels[mode]}{detail ? ` · ${detail}` : ''}</span></div><span className="study-count" aria-label={`已完成 ${completed}${unit}，共 ${total}${unit}`}>{completed}<span> / </span>{total}</span></div><Progress label="本轮学习进度" value={total ? completed / total * 100 : 0} /></header>
}

function LearnSteps({ stage }: { stage: 0 | 1 }) {
  return <div className="learn-steps" aria-label={`当前第 ${stage + 1} 步，共 2 步`}><span data-active={stage === 0}>1 认识词义</span><i aria-hidden="true" /><span data-active={stage === 1}>2 回忆英文</span></div>
}

function SprintSession({ initialStudy, pendingKey, mode, exit, reload, nextBatch }: { initialStudy: StudyBatch; pendingKey: string; mode: Mode; exit: () => void; reload: () => void; nextBatch: () => void }) {
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
  const [undoing, setUndoing] = useState(false)
  const [undoUnconfirmed, setUndoUnconfirmed] = useState(false)
  const [undoError, setUndoError] = useState<string | null>(null)
  const [undoAvailable, setUndoAvailable] = useState(false)
  const [lastConfirmed, setLastConfirmed] = useState<{ payload: Submission; confirmedAt: number } | null>(null)
  const transaction = useRef<Transaction | null>(null)
  const answerRequest = useRef<AbortController | null>(null)
  const revealedRef = useRef(false)
  const mounted = useRef(true)
  const wordElement = useRef<HTMLElement | null>(null)
  const definitionElement = useRef<HTMLDivElement | null>(null)
  const word = round.words[round.cursor]
  const displayedWordId = useRef(word?.id)
  const summary = summarizeStudyRound(round)
  const terminalFailure = failure instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(failure.status)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; answerRequest.current?.abort() }
  }, [])

  useEffect(() => {
    if (!lastConfirmed) return
    setUndoAvailable(true)
    const timeout = window.setTimeout(() => setUndoAvailable(false), Math.max(0, 120_000 - (Date.now() - lastConfirmed.confirmedAt)))
    return () => window.clearTimeout(timeout)
  }, [lastConfirmed])

  useEffect(() => {
    if (word && localStorage.getItem('word-auto-audio') === 'true') pronounce(word.text)
    return stopPronunciation
  }, [word?.id])

  useLayoutEffect(() => {
    displayedWordId.current = word?.id
    if (transaction.current?.phase === 'settled') {
      wordElement.current?.focus({ preventScroll: true })
      window.scrollTo({ top: 0, behavior: 'instant' })
      if (definitionElement.current) definitionElement.current.scrollTop = 0
    }
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
    if (!word || transaction.current || undoing || undoUnconfirmed || revealedRef.current) return
    revealedRef.current = true
    setRevealed(true)
  }

  async function send(payload: Submission) {
    transaction.current = { payload, phase: 'sending' }
    rememberAnswer(pendingKey, payload)
    const controller = new AbortController()
    answerRequest.current = controller
    setSaving(true)
    setFailure(null)
    setUndoError(null)
    try {
      await api<{ ok: true }>('/study/answer', { ...json('POST', payload), signal: controller.signal })
      forgetAnswer(pendingKey)
      for (const queryKey of ['stats', 'books', 'favorites', 'admin', 'study']) {
        void client.invalidateQueries({ queryKey: [queryKey], refetchType: 'none' })
      }
      if (!mounted.current) return
      transaction.current = { payload, phase: 'settled' }
      setTransitioning(true)
      setRound(current => completeStudyAnswer(current, payload.wordId, payload.answer, payload.eventId))
      setLastConfirmed({ payload, confirmedAt: Date.now() })
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
    if (!word || transaction.current || undoing || undoUnconfirmed) return
    const answer = studyAnswer(mode, revealedRef.current, decision)
    if (!answer) return
    void send({ wordId: word.id, mode, answer, eventId: createStudyEventId(), contentVersion: (word as Word & { contentVersion?: number }).contentVersion })
  }

  async function undoLastAnswer() {
    if (!lastConfirmed || transaction.current || undoing || (!undoAvailable && !undoUnconfirmed)) return
    const controller = new AbortController()
    answerRequest.current = controller
    setUndoing(true); setUndoUnconfirmed(true); setUndoError(null)
    rememberUndo(pendingKey, lastConfirmed.payload.eventId)
    try {
      await api('/study/answer/undo', { ...json('POST', { eventId: lastConfirmed.payload.eventId }), signal: controller.signal })
      forgetAnswer(pendingKey)
      for (const queryKey of ['stats', 'books', 'study', 'admin']) void client.invalidateQueries({ queryKey: [queryKey], refetchType: 'none' })
      if (!mounted.current) return
      transaction.current = { payload: lastConfirmed.payload, phase: 'settled' }
      setRound(current => undoStudyAnswer(current, lastConfirmed.payload.eventId))
      if (lastConfirmed.payload.answer === 'unsure-known') setReinforcedIds(current => { const next = new Set(current); next.delete(lastConfirmed.payload.wordId); return next })
      setLastConfirmed(null); setUndoAvailable(false)
      setUndoUnconfirmed(false)
      revealedRef.current = false; setRevealed(false)
      setTransitioning(true)
      window.scrollTo({ top: 0, behavior: 'instant' })
      toast.success('已撤销上一个词的判断，可以重新选择')
    } catch (error) {
      if (mounted.current) {
        // A transport failure does not tell us whether the undo committed; confirm it before a new judgment.
        const rejected = error instanceof ApiError && error.status >= 400 && error.status < 500
        if (rejected) forgetAnswer(pendingKey)
        setUndoUnconfirmed(!rejected)
        setUndoError(error instanceof Error ? error.message : '暂时无法确认撤销结果，请重试。')
      }
    } finally { if (mounted.current) setUndoing(false) }
  }

  function retryAnswer() {
    const failed = transaction.current
    if (failed?.phase !== 'failed') return
    void send(failed.payload)
  }

  function retryUnknown() {
    if (transaction.current || undoing || undoUnconfirmed || !summary.unknown.length) return
    setLastConfirmed(null); setUndoAvailable(false)
    revealedRef.current = false
    setRevealed(false)
    setRound(createStudyRound(summary.unknown, round.number + 1))
  }

  useEffect(() => {
    if (!word) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.altKey || event.metaKey || event.ctrlKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return
      if (event.repeat) {
        if (['1', '2', '3', ' ', 'f', 'F', 'Enter'].includes(event.key)) event.preventDefault()
        return
      }
      if (transaction.current || undoing || undoUnconfirmed) return
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault()
        pronounce(word.text)
      } else if (event.code === 'Space') {
        if (target?.closest('button, a, [role="button"]')) return
        event.preventDefault()
        revealMeaning()
      } else if (event.key === '1') {
        event.preventDefault()
        choose('unknown')
      } else if (event.key === '2') {
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

  const header = <StudyHeader book={book} mode={mode} exit={exit} saving={saving} completed={round.cursor} total={round.words.length} detail={round.number > 1 ? `第 ${round.number} 轮` : undefined} />
  const undoControl = <div className="sprint-undo" aria-live="polite">{lastConfirmed && (undoAvailable || undoUnconfirmed) ? <Button variant="ghost" isPending={undoing} isDisabled={saving || transitioning || !!failure} onPress={() => { void undoLastAnswer() }}><ArrowRotateLeft />{undoUnconfirmed ? '确认上次撤销结果' : '撤销上一个词的判断'}</Button> : <span>{round.cursor > 0 ? '最近一次判断可在 2 分钟内撤销' : '按第一印象选择，也可以撤销最近一次判断'}</span>}{undoError && <p role="alert">{undoError}{undoUnconfirmed && ' 确认前可退出，重新进入会读取当前进度。'}</p>}</div>
  if (!round.words.length) return <div className="study-page">{header}<main className="study-complete"><Empty title="这一轮，可以轻松收尾了" description="当前没有待速刷单词，模糊的词可以继续巩固。" action={<div className="flex flex-wrap justify-center gap-3"><Button variant="outline" onPress={exit}>返回词书</Button><Button onPress={() => navigate(`/study/${book.id}/reinforce`)}>查看巩固列表<ArrowRight /></Button></div>} /></main></div>

  if (!word) return <div className="study-page">{header}<main className="study-complete"><div className="study-complete-icon"><Check /></div><p className="text-sm text-muted">一点积累，一点进步</p><h1 className="mt-3 text-3xl font-semibold tracking-tight">这一轮，完成了。</h1><p className="mt-4 text-sm leading-6 text-muted">已完成 {round.results.length} 个单词的判断，学习记录已保存。</p><div className="study-summary"><SummaryCount label="直接掌握" value={summary.known} /><SummaryCount label="加入巩固" value={summary.reinforce} /><SummaryCount label="留待再刷" value={summary.unknown.length} /></div><p className="mt-6 max-w-md text-sm leading-6 text-muted">会的已标记掌握，模糊的已加入巩固，不会的继续留在速刷列表。</p>{undoControl}<div className="mt-8 flex flex-wrap justify-center gap-3">{initialStudy.hasMore && <Button isDisabled={undoing || undoUnconfirmed} onPress={nextBatch}>继续下一组<ArrowRight /></Button>}{summary.unknown.length > 0 && <Button isDisabled={undoing || undoUnconfirmed} onPress={retryUnknown}><ArrowRotateLeft />再刷本组不会的 {summary.unknown.length} 词</Button>}<Button variant={summary.unknown.length ? 'outline' : 'primary'} onPress={() => navigate(`/study/${book.id}/reinforce`)}>去巩固{reinforcedIds.size ? ` ${reinforcedIds.size} 词` : ''}<ArrowRight /></Button><Button variant="outline" onPress={exit}><BookOpen />返回词书</Button></div></main></div>

  return <div className="study-page">{header}<main className="sprint-main"><motion.section key={`${round.number}:${word.id}`} ref={wordElement} tabIndex={-1} aria-label="当前单词" className="sprint-word-area" initial={reduceMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.12 }} onAnimationComplete={() => unlockVisibleWord(word.id)}><h1 className="quiz-word" lang="en" aria-live="polite">{word.text}</h1><div className="study-pronunciation"><span lang="en">{word.phonetic || '音标暂缺'}</span><IconButton label="播放单词发音（F）" onPress={() => pronounce(word.text)} aria-keyshortcuts="F"><Volume /></IconButton></div><div ref={definitionElement} className="sprint-definition" tabIndex={revealed ? 0 : -1} role="region" aria-label="单词释义">{revealed && <p aria-live="polite">{word.meaning}</p>}</div></motion.section><div className="sprint-controls"><p className="sprint-instruction">{revealed ? '看过释义后选择“会”，会加入巩固列表。' : '凭第一印象，判断你是否认识这个词。'}</p>{failure ? <Card className="quiz-save-error" role="alert"><Card.Header><Card.Title>{terminalFailure ? '学习队列发生了变化' : '这次选择还没有确认'}</Card.Title><Card.Description>{failure.message}{!terminalFailure && ' 重试会提交同一次选择。'}</Card.Description></Card.Header><Card.Footer className="flex-wrap gap-3">{terminalFailure ? <Button onPress={failure instanceof ApiError && failure.status === 401 ? () => navigate('/login') : reload}>{failure instanceof ApiError && failure.status === 401 ? '重新登录' : '刷新学习队列'}</Button> : <Button onPress={retryAnswer} isPending={saving}>重试这次选择</Button>}<Button variant="outline" onPress={exit}>返回词书</Button></Card.Footer></Card> : <div className="sprint-answers" data-revealed={revealed}><Button fullWidth variant="outline" className="study-action" onPress={() => choose('unknown')} isDisabled={saving || transitioning || undoing || undoUnconfirmed} aria-keyshortcuts="1">不会<KeyHint value="1" /></Button><Button fullWidth variant="outline" className="study-action sprint-unsure" onPress={revealMeaning} isDisabled={saving || transitioning || undoing || undoUnconfirmed || revealed} aria-keyshortcuts="2 Space">{revealed ? '已看释义' : '不确定'}{!revealed && <KeyHint value="2" />}</Button><Button fullWidth className="study-action" onPress={() => choose('known')} isDisabled={saving || transitioning || undoing || undoUnconfirmed} aria-keyshortcuts="3">会<KeyHint value="3" /></Button></div>}<div className="study-keyboard-help" role="status" aria-live="polite">{saving ? '正在保存这次选择，可随时退出…' : failure ? '确认结果前，当前单词会保持在这里。' : <span>{revealed ? '1 不会 · 3 会 · F 发音' : '1 不会 · 2 / 空格 不确定 · 3 会 · F 发音'}</span>}</div>{undoControl}</div></main></div>
}

function KeyHint({ value }: { value: string }) {
  return <kbd className="study-key" aria-hidden="true">{value}</kbd>
}
function SummaryCount({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl bg-surface-secondary px-3 py-5"><strong className="block text-3xl font-semibold tracking-tight tabular-nums">{value}</strong><span className="mt-2 block text-xs text-muted">{label}</span></div>
}
