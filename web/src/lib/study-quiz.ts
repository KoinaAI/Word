import type { Word } from './types.ts'

export type QuizDirection = 'en-zh' | 'zh-en'
export type QuizOption = { id: number; label: string }
export type QuizQuestion = {
  key: string
  word: Word
  direction: QuizDirection
  kind: 'choice' | 'typing'
  options: QuizOption[]
  acceptedSpellings: readonly string[]
  spellingHint: string
  correction: boolean
}
export type QuizResult = { key: string; wordId: number; correct: boolean; correction: boolean }
export type QuizRound = { questions: QuizQuestion[]; cursor: number; results: QuizResult[]; wordCount: number; preparedPool?: PreparedQuizPool }

/** Compare spelling without penalizing capitalization, full-width letters or extra whitespace. */
export function normalizeSpelling(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

function meaningTerms(value: string): string[] {
  return value.normalize('NFKC').toLowerCase().split(/[;；,，、\n]/)
    .map(term => term.trim().replace(/^(?:(?:v\s*\.\s*[ti]|vt|vi|adj|adv|prep|pron|conj|interj|num|art|aux|n|v|a|ad)\s*\.\s*)+/i, '').replace(/\s/g, '').trim())
    .filter(Boolean)
}

type PoolEntry = { word: Word; spelling: string; terms: ReadonlySet<string>; signature: string }
type EquivalentSpellings = { values: readonly string[]; members: ReadonlySet<string> }
export type PreparedQuizPool = { entries: readonly PoolEntry[]; equivalent: ReadonlyMap<string, EquivalentSpellings> }
type QuizPool = readonly Word[] | PreparedQuizPool

function poolEntry(word: Word): PoolEntry {
  const terms = new Set(meaningTerms(word.meaning))
  return { word: { ...word }, spelling: normalizeSpelling(word.text), terms, signature: [...terms].sort().join('\u0000') }
}

/** Normalize one immutable vocabulary snapshot once, including its equivalent spelling groups. */
export function prepareQuizPool(words: readonly Word[]): PreparedQuizPool {
  const seen = new Set<number>()
  const entries: PoolEntry[] = []
  const groups = new Map<string, Set<string>>()
  for (const word of words) {
    if (seen.has(word.id)) continue
    seen.add(word.id)
    const entry = poolEntry(word)
    if (!entry.spelling || !entry.signature) continue
    entries.push(entry)
    const members = groups.get(entry.signature) || new Set<string>()
    members.add(entry.spelling)
    groups.set(entry.signature, members)
  }
  return { entries, equivalent: new Map([...groups].map(([signature, members]) => [signature, { values: [...members], members }])) }
}

function overlapsMeaning(left: PoolEntry, right: PoolEntry): boolean {
  for (const term of right.terms) if (left.terms.has(term)) return true
  return false
}

function gcd(left: number, right: number): number {
  while (right) [left, right] = [right, left % right]
  return left
}

function randomIndex(size: number, random: () => number): number {
  const value = random()
  return Math.min(size - 1, Math.max(0, Math.floor((Number.isFinite(value) ? value : 0) * size)))
}

/** Keep a spelling prompt identifiable even when the bounded pool cannot contain every synonym. */
function spellingHint(text: string): string {
  const characters = Array.from(normalizeSpelling(text))
  return `提示：一个可接受的答案以「${characters[0]}」开头，共 ${characters.length} 个字符。`
}

/** Accept equivalent complete definitions in this round without accepting merely shared senses. */
export function isCorrectSpelling(question: QuizQuestion, value: string): boolean {
  const spelling = normalizeSpelling(value)
  return !!spelling && question.acceptedSpellings.includes(spelling)
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.min(index, Math.floor(random() * (index + 1)))
    ;[result[index], result[other]] = [result[other]!, result[index]!]
  }
  return result
}

/** Sample genuine choices with bounded work; large books never get copied and shuffled per question. */
export function createQuizQuestion(word: Word, pool: QuizPool, direction: QuizDirection, correction = false, random = Math.random): QuizQuestion {
  const prepared = Array.isArray(pool) ? prepareQuizPool(pool) : pool as PreparedQuizPool
  const target = poolEntry(word)
  const candidates = [target]
  const size = prepared.entries.length
  const start = size ? randomIndex(size, random) : 0
  let stride = size > 1 ? randomIndex(size - 1, random) + 1 : 1
  while (size > 1 && gcd(stride, size) !== 1) stride = stride % (size - 1) + 1
  // A sparse or synonymous sample falls back to a fair spelling task rather than scanning the full book.
  for (let offset = 0; offset < Math.min(size, 128); offset++) {
    const candidate = prepared.entries[(start + offset * stride) % size]!
    if (candidates.some(existing => existing.word.id === candidate.word.id
      || existing.spelling === candidate.spelling
      || overlapsMeaning(existing, candidate))) continue
    candidates.push(candidate)
    if (candidates.length === 4) break
  }
  // A one-word or wholly synonymous book cannot produce an honest multiple-choice question.
  const kind = candidates.length > 1 ? 'choice' : 'typing'
  const actualDirection = kind === 'typing' ? 'zh-en' : direction
  const equivalent = prepared.equivalent.get(target.signature)
  const acceptedSpellings = equivalent?.members.has(target.spelling)
    ? equivalent.values : [target.spelling, ...(equivalent?.values || [])]
  return {
    key: `${correction ? 'correction' : 'initial'}:${word.id}`,
    word: { ...word },
    direction: actualDirection,
    kind,
    options: kind === 'choice' ? shuffled(candidates, random).map(candidate => ({ id: candidate.word.id, label: actualDirection === 'en-zh' ? candidate.word.meaning : candidate.word.text })) : [],
    acceptedSpellings,
    spellingHint: spellingHint(word.text),
    correction,
  }
}

/** Alternate recognition and recall while keeping each rendered question stable throughout retries. */
export function createQuizRound(words: Word[], pool: Word[], random = Math.random): QuizRound {
  const seen = new Set<number>()
  const unique = words.filter(word => { if (seen.has(word.id)) return false; seen.add(word.id); return true })
  const preparedPool = prepareQuizPool([...unique, ...pool])
  return { questions: unique.map((word, index) => createQuizQuestion(word, preparedPool, index % 2 ? 'zh-en' : 'en-zh', false, random)), cursor: 0, results: [], wordCount: unique.length, preparedPool }
}

/** Record one confirmed answer; each first-pass mistake gets at most one local correction question. */
export function recordQuizAnswer(round: QuizRound, key: string, correct: boolean, pool: Word[], random = Math.random): QuizRound {
  const question = round.questions[round.cursor]
  if (!question || question.key !== key || round.results.some(result => result.key === key)) return round
  const retry = !correct && !question.correction
    ? [createQuizQuestion(question.word, round.preparedPool || pool, question.direction === 'en-zh' ? 'zh-en' : 'en-zh', true, random)]
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

/** Keep the first-pass goal fixed; correction practice has its own explicit progress. */
export function quizProgress(round: QuizRound) {
  const question = round.questions[round.cursor]
  const summary = summarizeQuizRound(round)
  if (!question) return { phase: 'complete' as const, completed: round.wordCount, total: round.wordCount }
  if (question.correction) return { phase: 'correction' as const, completed: summary.correctionCount, total: round.questions.length - round.wordCount }
  return { phase: 'practice' as const, completed: summary.answered, total: round.wordCount }
}
