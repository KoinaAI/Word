import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowLeft, ArrowRight, ArrowRotateLeft, BookOpen, Check, Volume, Xmark } from '@gravity-ui/icons'
import { Button, Card, Input, TextField } from '@heroui/react'
import { Empty, Failure, IconButton, Loading, Progress } from '@/components/shared'
import { ApiError, api, json, useUser } from '@/lib/api'
import { pronounce, stopPronunciation } from '@/lib/speech'
import { completeStudyAnswer, createStudyEventId, createStudyRound, studyAnswer, summarizeStudyRound } from '@/lib/study-flow'
import type { StudyDecision } from '@/lib/study-flow'
import type { Answer, Book, Mode, Study, Word } from '@/lib/types'
import { advanceQuizRound, createQuizRound, normalizeSpelling, recordQuizAnswer, summarizeQuizRound } from '@/lib/study-quiz'
import './study.css'

const modeLabels: Record<Mode, string> = { learn: '日常学习', review: '记忆复习', sprint: '临考速刷', reinforce: '重点巩固' }
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
  const vocabulary = useQuery({
    queryKey: ['books', bookId, 'quiz-vocabulary'],
    queryFn: ({ signal }) => api<{ book: Book; words: Word[] }>(`/books/${bookId}`, { signal }),
    enabled: mode !== 'sprint',
    staleTime: Infinity,
    retry: false,
  })
  const exit = () => navigate(`/books/${bookId}`)
  const loading = study.isPending || (mode !== 'sprint' && vocabulary.isPending)
  const error = study.error || (mode !== 'sprint' ? vocabulary.error : null)
  if (loading || error || !study.data) {
    return <div className="min-h-dvh bg-background px-6"><div className="mx-auto max-w-5xl py-6"><Button variant="ghost" onPress={exit}><ArrowLeft />返回词书</Button></div>{loading ? <Loading label="正在准备本轮单词" /> : <Failure error={error} retry={() => { void study.refetch(); if (mode !== 'sprint') void vocabulary.refetch() }} />}</div>
  }
  return mode === 'sprint'
    ? <SprintSession key={generation} initialStudy={study.data} mode={mode} exit={exit} reload={() => setGeneration(value => value + 1)} />
    : <QuizSession key={generation} initialStudy={study.data} vocabulary={vocabulary.data?.words || study.data.words} mode={mode} exit={exit} reload={() => setGeneration(value => value + 1)} />
}

type QuizFeedback = { correct: boolean; selectedId?: number; spelling?: string }
type QuizTransaction = { payload: Submission; questionKey: string; correct: boolean }

function QuizSession({ initialStudy, vocabulary, mode, exit, reload }: { initialStudy: Study; vocabulary: Word[]; mode: Mode; exit: () => void; reload: () => void }) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const reduceMotion = useReducedMotion()
  const [round, setRound] = useState(() => createQuizRound(initialStudy.words, vocabulary))
  const [feedback, setFeedback] = useState<QuizFeedback | null>(null)
  const [spelling, setSpelling] = useState('')
  const [saving, setSaving] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const [failure, setFailure] = useState<Error | null>(null)
  const transaction = useRef<(QuizTransaction & { phase: 'sending' | 'failed' }) | null>(null)
  const locked = useRef(false)
  const moving = useRef(false)
  const mounted = useRef(true)
  const questionElement = useRef<HTMLElement | null>(null)
  const question = round.questions[round.cursor]
  const displayedKey = useRef(question?.key)
  const summary = summarizeQuizRound(round)
  const terminalFailure = failure instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(failure.status)
  const audioAllowed = !!question && (question.direction === 'en-zh' || !!feedback)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    // Reading a Chinese prompt aloud would disclose the answer before the learner has chosen.
    if (question?.direction === 'en-zh' && localStorage.getItem('word-auto-audio') === 'true') pronounce(question.word.text)
    return stopPronunciation
  }, [question?.key])

  useLayoutEffect(() => {
    displayedKey.current = question?.key
    if (moving.current) questionElement.current?.focus({ preventScroll: true })
    if (!question || reduceMotion) unlockQuestion(question?.key)
  }, [question?.key, reduceMotion])

  function unlockQuestion(key: string | undefined) {
    if (displayedKey.current !== key || !moving.current) return
    moving.current = false
    locked.current = false
    setTransitioning(false)
  }

  async function saveAnswer(pending: QuizTransaction) {
    if (transaction.current?.phase === 'sending') return
    transaction.current = { ...pending, phase: 'sending' }
    setSaving(true)
    setFailure(null)
    try {
      await api<{ ok: true }>('/study/answer', json('POST', pending.payload))
      for (const queryKey of ['stats', 'books', 'favorites', 'admin', 'study']) {
        void client.invalidateQueries({ queryKey: [queryKey], refetchType: 'none' })
      }
      if (!mounted.current) return
      setRound(current => recordQuizAnswer(current, pending.questionKey, pending.correct, vocabulary))
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
    if (question.correction) {
      // The first answer already schedules review. Local correction must not extend that interval.
      setRound(current => recordQuizAnswer(current, question.key, choice.correct, vocabulary))
      return
    }
    void saveAnswer({
      questionKey: question.key,
      correct: choice.correct,
      payload: { wordId: question.word.id, mode, answer: choice.correct ? 'known' : 'unknown', eventId: createStudyEventId() },
    })
  }

  function nextQuestion() {
    if (!question || !feedback || saving || failure || moving.current || !round.results.some(result => result.key === question.key)) return
    moving.current = true
    setTransitioning(true)
    setRound(current => advanceQuizRound(current))
    setFeedback(null)
    setSpelling('')
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

  const header = <StudyHeader book={initialStudy.book} mode={mode} exit={exit} saving={saving} completed={round.cursor} total={round.questions.length} detail={question?.correction ? '错词再练' : '双向选择练习'} />
  if (!round.wordCount) {
    return <div className="study-page">{header}<main className="study-complete"><Empty title={mode === 'review' ? '暂时没有到期的复习' : mode === 'reinforce' ? '巩固列表已经清空' : '这本词书的新词已学完'} description={mode === 'reinforce' ? '速刷中看过释义后选择“会”的词，会在这里做双向练习。' : '选择其他词书，或等下次复习到期后再来。'} action={<Button variant="outline" onPress={exit}>返回词书</Button>} /></main></div>
  }
  if (!question) {
    return <div className="study-page">{header}<main className="study-complete"><div className="study-complete-icon"><Check /></div><p className="text-sm text-muted">{modeLabels[mode]}已完成</p><h1 className="mt-3 text-3xl font-semibold tracking-tight">记住一点，再前进一点。</h1><p className="mt-4 text-sm leading-6 text-muted">本轮学习 {round.wordCount} 个单词，首次答对 {summary.correct} 个。</p><div className="study-summary"><SummaryCount label="首次答对" value={summary.correct} /><SummaryCount label="需要再记" value={summary.mistakes} />{summary.correctionCount > 0 && <SummaryCount label="纠错答对" value={summary.corrected} />}</div><p className="mt-6 max-w-md text-sm leading-6 text-muted">{summary.mistakes ? mode === 'reinforce' ? '首次答错的词已返回新词列表，方便重新打好基础。' : '首次答错的词已安排短间隔复习，约 10 分钟后再见。' : '答对的单词已进入间隔复习计划。'}{summary.correctionCount > 0 && ' 本轮纠错练习不重复计入学习次数。'}</p><div className="mt-8 flex flex-wrap justify-center gap-3">{mode === 'learn' && <Button onPress={reload}>再学一组<ArrowRight /></Button>}{mode === 'reinforce' && summary.mistakes > 0 && <Button onPress={() => navigate(`/study/${initialStudy.book.id}/learn`)}>练习新词<ArrowRight /></Button>}<Button variant="outline" onPress={exit}><BookOpen />返回词书</Button></div></main></div>
  }

  return <div className="study-page">{header}<main className="quiz-main">
    <motion.section key={question.key} ref={questionElement} tabIndex={-1} aria-label="当前题目" className="quiz-question" initial={reduceMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.12 }} onAnimationComplete={() => unlockQuestion(question.key)}>
      <div className="quiz-prompt">
        <span className="quiz-direction">{question.correction ? '错词再练 · ' : ''}{question.direction === 'en-zh' ? '英译中' : '中译英'}</span>
        <p className="quiz-instruction">{question.kind === 'typing' ? '写出对应的英文单词' : question.direction === 'en-zh' ? '选择正确的中文释义' : '选择对应的英文单词'}</p>
        <h1 className={question.direction === 'en-zh' ? 'quiz-word' : 'quiz-meaning'} lang={question.direction === 'en-zh' ? 'en' : 'zh-CN'}>{question.direction === 'en-zh' ? question.word.text : question.word.meaning}</h1>
        {question.direction === 'en-zh' && <div className="study-pronunciation"><span lang="en">{question.word.phonetic || '音标暂缺'}</span><IconButton label="播放单词发音（F）" onPress={() => pronounce(question.word.text)} aria-keyshortcuts="F"><Volume /></IconButton></div>}
      </div>
      {question.kind === 'choice' ? <div className="quiz-options" role="group" aria-label="答案选项">{question.options.map((option, index) => {
        const correctOption = !!feedback && option.id === question.word.id
        const wrongOption = !!feedback && option.id === feedback.selectedId && !feedback.correct
        return <Button key={option.id} fullWidth variant="outline" className="quiz-option" data-answer={correctOption ? 'correct' : wrongOption ? 'wrong' : undefined} isDisabled={!!feedback || transitioning} onPress={() => answerQuiz({ correct: option.id === question.word.id, selectedId: option.id })} aria-keyshortcuts={String(index + 1)}><span className="quiz-option-number" aria-hidden="true">{index + 1}</span><span className="quiz-option-text" lang={question.direction === 'en-zh' ? 'zh-CN' : 'en'}>{option.label}</span>{correctOption ? <Check aria-label="正确答案" /> : wrongOption ? <Xmark aria-label="本次选择错误" /> : null}</Button>
      })}</div> : <form className="quiz-spelling" onSubmit={event => { event.preventDefault(); if (spelling.trim()) answerQuiz({ correct: normalizeSpelling(spelling) === normalizeSpelling(question.word.text), spelling: spelling.trim() }) }}><TextField aria-label="英文拼写" isDisabled={!!feedback || transitioning} value={spelling} onChange={setSpelling}><Input fullWidth autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="输入英文单词" /></TextField><Button fullWidth type="submit" isDisabled={!spelling.trim() || !!feedback || transitioning}>确认答案<KeyHint value="Enter" /></Button><p className="text-center text-xs text-muted">这本词书的可区分选项较少，本题练习拼写。</p></form>}
      <div className="quiz-feedback-slot">
        {feedback ? <div className="quiz-feedback" data-correct={feedback.correct} role="status" aria-live="polite"><div className="quiz-feedback-title">{feedback.correct ? <Check /> : <Xmark />}<strong>{feedback.correct ? question.correction ? '这次记住了' : '回答正确' : '再记一次，会更牢'}</strong></div>{question.direction === 'zh-en' && <div className="quiz-feedback-word"><strong lang="en">{question.word.text}</strong><span>{question.word.phonetic}</span><IconButton label="播放单词发音（F）" onPress={() => pronounce(question.word.text)} aria-keyshortcuts="F"><Volume /></IconButton></div>}<p className="quiz-feedback-meaning">{question.word.meaning}</p>{feedback.spelling && !feedback.correct && <p className="mt-2 text-sm text-muted">你的拼写：{feedback.spelling}</p>}{question.word.example && <div className="quiz-example"><p lang="en">{question.word.example}</p>{question.word.exampleMeaning && <p>{question.word.exampleMeaning}</p>}</div>}{!feedback.correct && !question.correction && <p className="quiz-correction-note">本轮结束前，会再练习一次这个单词。</p>}</div> : <p className="quiz-help">{question.kind === 'choice' ? `按 1–${question.options.length} 选择${audioAllowed ? ' · F 发音' : ''}` : '输入后按 Enter 确认'}</p>}
      </div>
    </motion.section>
    {failure ? <Card className="quiz-save-error" role="alert"><Card.Header><Card.Title>{terminalFailure ? '学习队列发生了变化' : '答案还没有保存成功'}</Card.Title><Card.Description>{failure.message}{!terminalFailure && ' 重试会保存同一次选择。'}</Card.Description></Card.Header><Card.Footer className="flex-wrap gap-3">{terminalFailure ? <Button onPress={failure instanceof ApiError && failure.status === 401 ? () => navigate('/login') : reload}>{failure instanceof ApiError && failure.status === 401 ? '重新登录' : '刷新学习队列'}</Button> : <Button isPending={saving} onPress={() => { if (transaction.current) void saveAnswer(transaction.current) }}>重试保存</Button>}<Button variant="outline" onPress={exit} isDisabled={saving}>返回词书</Button></Card.Footer></Card> : feedback && <div className="quiz-next"><Button fullWidth onPress={nextQuestion} isDisabled={saving || transitioning} isPending={saving} className="study-action" aria-keyshortcuts="Enter">{saving ? '正在保存' : round.cursor === round.questions.length - 1 ? '完成本轮' : '下一题'}<KeyHint value="Enter" /></Button><span className="quiz-help">{question.correction ? '纠错练习，不重复计入学习次数' : 'F 发音 · Enter 继续'}</span></div>}
  </main></div>
}

function StudyHeader({ book, mode, exit, saving, completed, total, detail }: { book: Book; mode: Mode; exit: () => void; saving: boolean; completed: number; total: number; detail?: string }) {
  return <header className="study-header"><div className="study-header-row"><Button variant="ghost" onPress={exit} isDisabled={saving} className="study-exit"><ArrowLeft /><span>退出</span></Button><div className="study-header-title"><p>{book.title}</p><span>{modeLabels[mode]}{detail ? ` · ${detail}` : ''}</span></div><span className="study-count" aria-label={`已完成 ${completed} 题，共 ${total} 题`}>{completed}<span> / </span>{total}</span></div><Progress label="本轮学习进度" value={total ? completed / total * 100 : 0} /></header>
}

function SprintSession({ initialStudy, mode, exit, reload }: { initialStudy: Study; mode: Mode; exit: () => void; reload: () => void }) {
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
  const wordElement = useRef<HTMLElement | null>(null)
  const word = round.words[round.cursor]
  const displayedWordId = useRef(word?.id)
  const summary = summarizeStudyRound(round)
  const terminalFailure = failure instanceof ApiError && [400, 401, 403, 404, 409, 422].includes(failure.status)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (word && localStorage.getItem('word-auto-audio') === 'true') pronounce(word.text)
    return stopPronunciation
  }, [word?.id])

  useLayoutEffect(() => {
    displayedWordId.current = word?.id
    if (transaction.current?.phase === 'settled') wordElement.current?.focus({ preventScroll: true })
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
    void send(failed.payload)
  }

  function retryUnknown() {
    if (transaction.current || !summary.unknown.length) return
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
      if (transaction.current) return
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
  if (!round.words.length) return <div className="study-page">{header}<main className="study-complete"><Empty title="这一轮，可以轻松收尾了" description="当前没有待速刷单词，模糊的词可以继续巩固。" action={<div className="flex flex-wrap justify-center gap-3"><Button variant="outline" onPress={exit}>返回词书</Button><Button onPress={() => navigate(`/study/${book.id}/reinforce`)}>查看巩固列表<ArrowRight /></Button></div>} /></main></div>

  if (!word) return <div className="study-page">{header}<main className="study-complete"><div className="study-complete-icon"><Check /></div><p className="text-sm text-muted">一点积累，一点进步</p><h1 className="mt-3 text-3xl font-semibold tracking-tight">这一轮，完成了。</h1><p className="mt-4 text-sm leading-6 text-muted">已完成 {round.results.length} 个单词的判断，学习记录已保存。</p><div className="study-summary"><SummaryCount label="直接掌握" value={summary.known} /><SummaryCount label="加入巩固" value={summary.reinforce} /><SummaryCount label="留待再刷" value={summary.unknown.length} /></div><p className="mt-6 max-w-md text-sm leading-6 text-muted">会的已标记掌握，模糊的已加入巩固，不会的继续留在速刷列表。</p><div className="mt-8 flex flex-wrap justify-center gap-3">{summary.unknown.length > 0 && <Button onPress={retryUnknown}><ArrowRotateLeft />再刷不会的 {summary.unknown.length} 词</Button>}<Button variant={summary.unknown.length ? 'outline' : 'primary'} onPress={() => navigate(`/study/${book.id}/reinforce`)}>去巩固{reinforcedIds.size ? ` ${reinforcedIds.size} 词` : ''}<ArrowRight /></Button><Button variant="outline" onPress={exit}><BookOpen />返回词书</Button></div></main></div>

  return <div className="study-page">{header}<main className="sprint-main"><motion.section key={`${round.number}:${word.id}`} ref={wordElement} tabIndex={-1} aria-label="当前单词" className="sprint-word-area" initial={reduceMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.12 }} onAnimationComplete={() => unlockVisibleWord(word.id)}><h1 className="quiz-word" lang="en" aria-live="polite">{word.text}</h1><div className="study-pronunciation"><span lang="en">{word.phonetic || '音标暂缺'}</span><IconButton label="播放单词发音（F）" onPress={() => pronounce(word.text)} aria-keyshortcuts="F"><Volume /></IconButton></div><div className="sprint-definition">{revealed && <p aria-live="polite">{word.meaning}</p>}</div></motion.section><div className="sprint-controls"><p className="sprint-instruction">{revealed ? '看过释义后选择“会”，会加入巩固列表。' : '凭第一印象，判断你是否认识这个词。'}</p>{failure ? <Card className="quiz-save-error" role="alert"><Card.Header><Card.Title>{terminalFailure ? '学习队列发生了变化' : '这次选择还没有确认'}</Card.Title><Card.Description>{failure.message}{!terminalFailure && ' 重试会提交同一次选择。'}</Card.Description></Card.Header><Card.Footer className="flex-wrap gap-3">{terminalFailure ? <Button onPress={failure instanceof ApiError && failure.status === 401 ? () => navigate('/login') : reload}>{failure instanceof ApiError && failure.status === 401 ? '重新登录' : '刷新学习队列'}</Button> : <Button onPress={retryAnswer} isPending={saving}>重试这次选择</Button>}<Button variant="outline" onPress={exit} isDisabled={saving}>返回词书</Button></Card.Footer></Card> : <div className="sprint-answers" data-revealed={revealed}><Button fullWidth variant="outline" className="study-action" onPress={() => choose('unknown')} isDisabled={saving || transitioning} aria-keyshortcuts="1">不会<KeyHint value="1" /></Button>{!revealed && <Button fullWidth variant="outline" className="study-action" onPress={revealMeaning} isDisabled={saving || transitioning} aria-keyshortcuts="2 Space">不确定<KeyHint value="2" /></Button>}<Button fullWidth className="study-action" onPress={() => choose('known')} isDisabled={saving || transitioning} aria-keyshortcuts="3">会<KeyHint value="3" /></Button></div>}<div className="study-keyboard-help" role="status" aria-live="polite">{saving ? '正在保存这次选择…' : failure ? '确认结果前，当前单词会保持在这里。' : <span>{revealed ? '1 不会 · 3 会 · F 发音' : '1 不会 · 2 / 空格 不确定 · 3 会 · F 发音'}</span>}</div></div></main></div>
}

function KeyHint({ value }: { value: string }) {
  return <kbd className="study-key" aria-hidden="true">{value}</kbd>
}
function SummaryCount({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl bg-surface-secondary px-3 py-5"><strong className="block text-3xl font-semibold tracking-tight tabular-nums">{value}</strong><span className="mt-2 block text-xs text-muted">{label}</span></div>
}
