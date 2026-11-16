import { createQuizQuestion, prepareQuizPool } from './study-quiz.ts'
import type { PreparedQuizPool, QuizQuestion, QuizResult, QuizRound } from './study-quiz.ts'
import type { Word } from './types.ts'

export type LearnQuestion = QuizQuestion & { learnStage: 0 | 1; learnRevision: number }
export type LearnAnswerResponse = { ok: true; learnStage: 0 | 1 | 2; learnRevision: number; completed: boolean }
export type LearnResult = QuizResult & { learnStage: 0 | 1; learnRevision: number; completed: boolean }
export type LearnRound = Omit<QuizRound, 'questions' | 'results'> & {
  kind: 'learn'
  questions: LearnQuestion[]
  results: LearnResult[]
}

function createLearnQuestion(word: Word, pool: Word[] | PreparedQuizPool, stage: 0 | 1, revision: number, random: () => number): LearnQuestion {
  const snapshot = { ...word, learnStage: stage, learnRevision: revision }
  const question = createQuizQuestion(snapshot, pool, stage === 0 ? 'en-zh' : 'zh-en', revision > stage, random)
  // Recognition must remain the first step even when the book has no honest distractor.
  // Recall in the second step still uses the shared spelling fallback for such books.
  if (stage === 0 && question.kind === 'typing') {
    question.kind = 'choice'
    question.direction = 'en-zh'
    question.options = [{ id: word.id, label: word.meaning }]
  }
  return { ...question, key: `learn:${word.id}:${revision}`, learnStage: stage, learnRevision: revision }
}

/** Resume each unfinished word at its saved stage; each word appears at most once in the initial queue. */
export function createLearnRound(words: Word[], pool: Word[], random = Math.random): LearnRound {
  const seen = new Set<number>()
  const questions: LearnQuestion[] = []
  const preparedPool = prepareQuizPool([...words, ...pool])
  for (const word of words) {
    if (seen.has(word.id)) continue
    seen.add(word.id)
    if (word.learnStage === 2) continue
    questions.push(createLearnQuestion(word, preparedPool, word.learnStage ?? 0, word.learnRevision ?? 0, random))
  }
  return { kind: 'learn', questions, cursor: 0, results: [], wordCount: questions.length, preparedPool }
}

/** Check that a server acknowledgement confirms exactly this stage and revision transition. */
export function isLearnAnswerResponse(question: LearnQuestion, correct: boolean, response: unknown): response is LearnAnswerResponse {
  if (!response || typeof response !== 'object') return false
  const saved = response as Partial<LearnAnswerResponse>
  const nextStage = correct ? question.learnStage + 1 : 0
  return saved.ok === true && saved.learnStage === nextStage
    && Number.isSafeInteger(saved.learnRevision) && saved.learnRevision === question.learnRevision + 1
    && saved.completed === (nextStage === 2)
}

/** Record only a confirmed current answer, then interleave the next stage or a restart after pending words. */
export function recordLearnAnswer(round: LearnRound, key: string, correct: boolean, response: unknown, pool: Word[], random = Math.random): LearnRound {
  const question = round.questions[round.cursor]
  if (!question || question.key !== key || round.results.some(result => result.key === key)
    || !isLearnAnswerResponse(question, correct, response)) return round
  const next = response.learnStage === 2 ? [] : [createLearnQuestion(question.word, round.preparedPool || pool, response.learnStage, response.learnRevision, random)]
  return {
    ...round,
    questions: [...round.questions, ...next],
    results: [...round.results, {
      key, wordId: question.word.id, correct, correction: question.correction,
      learnStage: question.learnStage, learnRevision: question.learnRevision, completed: response.completed,
    }],
  }
}

/** Keep feedback visible until the learner advances a confirmed answer. */
export function advanceLearnRound(round: LearnRound): LearnRound {
  const question = round.questions[round.cursor]
  if (!question || !round.results.some(result => result.key === question.key)) return round
  return { ...round, cursor: round.cursor + 1 }
}

/** Count completed words separately from attempts and keep each missed word once in the recap. */
export function summarizeLearnRound(round: LearnRound) {
  const completed = new Set<number>()
  const missed = new Set<number>()
  for (const result of round.results) {
    if (result.completed) completed.add(result.wordId)
    if (!result.correct) missed.add(result.wordId)
  }
  const mistakes: Word[] = []
  const included = new Set<number>()
  for (const question of round.questions) {
    if (missed.has(question.word.id) && !included.has(question.word.id)) {
      mistakes.push(question.word)
      included.add(question.word.id)
    }
  }
  return {
    completed: completed.size,
    attempts: round.results.length,
    correctAnswers: round.results.filter(result => result.correct).length,
    restartedWords: missed.size,
    mistakes,
  }
}

/** Only words that passed both stages advance the global progress; retries never change its goal. */
export function learnProgress(round: LearnRound) {
  return {
    phase: round.questions[round.cursor] ? 'practice' as const : 'complete' as const,
    completed: summarizeLearnRound(round).completed,
    total: round.wordCount,
  }
}
