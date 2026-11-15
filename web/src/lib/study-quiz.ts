import type { Word } from './types.ts'

export type QuizDirection = 'en-zh' | 'zh-en'
export type QuizOption = { id: number; label: string }
export type QuizQuestion = {
  key: string
  word: Word
  direction: QuizDirection
  kind: 'choice' | 'typing'
  options: QuizOption[]
  correction: boolean
}
export type QuizResult = { key: string; wordId: number; correct: boolean; correction: boolean }
export type QuizRound = { questions: QuizQuestion[]; cursor: number; results: QuizResult[]; wordCount: number }

/** Compare spelling without penalizing capitalization, full-width letters or extra whitespace. */
export function normalizeSpelling(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

function meaningTerms(value: string): string[] {
  return value.normalize('NFKC').toLowerCase().split(/[;；,，、\n]/)
    .map(term => term.trim().replace(/^(?:(?:n|v|vt|vi|adj|adv|prep|pron|conj|interj|num|art|aux)\s*\.\s*)+/, '').replace(/\s/g, '').trim())
    .filter(Boolean)
}

function overlapsMeaning(left: Word, right: Word): boolean {
  const terms = new Set(meaningTerms(left.meaning))
  return meaningTerms(right.meaning).some(term => terms.has(term))
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.min(index, Math.floor(random() * (index + 1)))
    ;[result[index], result[other]] = [result[other]!, result[index]!]
  }
  return result
}

/** Build stable choices from actual vocabulary, excluding duplicate spellings and shared meanings. */
export function createQuizQuestion(word: Word, pool: Word[], direction: QuizDirection, correction = false, random = Math.random): QuizQuestion {
  const candidates = [word]
  for (const candidate of shuffled(pool, random)) {
    if (!candidate.text.trim() || !candidate.meaning.trim()) continue
    if (candidates.some(existing => existing.id === candidate.id
      || normalizeSpelling(existing.text) === normalizeSpelling(candidate.text)
      || overlapsMeaning(existing, candidate))) continue
    candidates.push(candidate)
    if (candidates.length === 4) break
  }
  // A one-word or wholly synonymous book cannot produce an honest multiple-choice question.
  const kind = candidates.length > 1 ? 'choice' : 'typing'
  const actualDirection = kind === 'typing' ? 'zh-en' : direction
  return {
    key: `${correction ? 'correction' : 'initial'}:${word.id}`,
    word: { ...word },
    direction: actualDirection,
    kind,
    options: kind === 'choice' ? shuffled(candidates, random).map(candidate => ({ id: candidate.id, label: actualDirection === 'en-zh' ? candidate.meaning : candidate.text })) : [],
    correction,
  }
}

/** Alternate recognition and recall while keeping each rendered question stable throughout retries. */
export function createQuizRound(words: Word[], pool: Word[], random = Math.random): QuizRound {
  const unique = words.filter((word, index) => words.findIndex(candidate => candidate.id === word.id) === index)
  return { questions: unique.map((word, index) => createQuizQuestion(word, pool, index % 2 ? 'zh-en' : 'en-zh', false, random)), cursor: 0, results: [], wordCount: unique.length }
}

/** Record one confirmed answer; each first-pass mistake gets at most one local correction question. */
export function recordQuizAnswer(round: QuizRound, key: string, correct: boolean, pool: Word[], random = Math.random): QuizRound {
  const question = round.questions[round.cursor]
  if (!question || question.key !== key || round.results.some(result => result.key === key)) return round
  const retry = !correct && !question.correction
    ? [createQuizQuestion(question.word, pool, question.direction === 'en-zh' ? 'zh-en' : 'en-zh', true, random)]
    : []
  return {
    ...round,
    questions: [...round.questions, ...retry],
    results: [...round.results, { key, wordId: question.word.id, correct, correction: question.correction }],
  }
}

/** Feedback remains on screen until the learner explicitly advances a confirmed answer. */
export function advanceQuizRound(round: QuizRound): QuizRound {
  const question = round.questions[round.cursor]
  if (!question || !round.results.some(result => result.key === question.key)) return round
  return { ...round, cursor: round.cursor + 1 }
}

export function summarizeQuizRound(round: QuizRound) {
  const firstPass = round.results.filter(result => !result.correction)
  const corrections = round.results.filter(result => result.correction)
  return {
    answered: firstPass.length,
    correct: firstPass.filter(result => result.correct).length,
    mistakes: firstPass.filter(result => !result.correct).length,
    corrected: corrections.filter(result => result.correct).length,
    correctionCount: corrections.length,
  }
}
