import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advanceQuizRound, createQuizQuestion, createQuizRound, isCorrectSpelling, normalizeSpelling, quizProgress, recordQuizAnswer, summarizeQuizRound } from '../src/lib/study-quiz.ts'
import type { Word } from '../src/lib/types.ts'

const word = (id: number, text: string, meaning: string): Word => ({ id, text, meaning, bookId: 1, phonetic: '', example: '', exampleMeaning: '', favorite: false, status: 'new', reinforce: false })
const vocabulary = [word(1, 'achieve', 'v. 达成；实现'), word(2, 'benefit', 'n. 益处；好处'), word(3, 'create', 'v. 创造'), word(4, 'demand', 'n. 需求'), word(5, 'efficient', 'adj. 高效的')]
const stableRandom = () => 0.4

test('alternates directions and snapshots stable four-choice questions', () => {
  const round = createQuizRound(vocabulary, vocabulary, stableRandom)
  assert.deepEqual(round.questions.map(question => question.direction), ['en-zh', 'zh-en', 'en-zh', 'zh-en', 'en-zh'])
  for (const question of round.questions) {
    assert.equal(question.options.length, 4)
    assert.equal(new Set(question.options.map(option => option.label)).size, 4)
    assert.equal(question.options.filter(option => option.id === question.word.id).length, 1)
  }
  const originalMeaning = round.questions[0]!.word.meaning
  const copy = vocabulary.map(item => ({ ...item }))
  const snapshot = createQuizRound(copy, copy, stableRandom)
  copy[0]!.meaning = 'modified'
  assert.equal(snapshot.questions[0]!.word.meaning, originalMeaning)
})

test('filters repeated spellings and overlapping Chinese senses in both directions', () => {
  const ambiguous = [vocabulary[0]!, word(10, 'realize', 'vt. 实现'), word(11, ' ACHIEVE ', 'v. 完成'), ...vocabulary.slice(1)]
  for (const direction of ['en-zh', 'zh-en'] as const) {
    const question = createQuizQuestion(vocabulary[0]!, ambiguous, direction, false, stableRandom)
    assert.equal(question.options.some(option => option.id === 10 || option.id === 11), false)
    assert.equal(question.options.length, 4)
  }
  const spaced = word(12, 'achieve', 'v. 达成; v. 实现')
  const question = createQuizQuestion(spaced, [spaced, word(13, 'realize', 'v. 实现'), ...vocabulary.slice(1)], 'zh-en', false, stableRandom)
  assert.equal(question.options.some(option => option.id === 13), false)
})

test('normalizes common POS forms and accepts exact equivalent spellings', () => {
  const target = word(1, 'quick', 'adj. 快速的')
  const question = createQuizQuestion(target, [target, word(2, 'fast', 'a. 快速的'), ...vocabulary.slice(1)], 'zh-en', false, stableRandom)
  assert.equal(question.options.some(option => option.id === 2), false)
  const typing = createQuizQuestion(target, [target, word(3, 'fast', 'a. 快速的')], 'zh-en', false, stableRandom)
  assert.equal(typing.kind, 'typing')
  assert.equal(isCorrectSpelling(typing, 'fast'), true)
  assert.equal(isCorrectSpelling(typing, 'FAST'), true)
  assert.equal(isCorrectSpelling(typing, 'rapid'), false)
  assert.match(typing.spellingHint, /一个可接受的答案以/) 
})

test('deduplicates large queues without quadratic first-pass scans', () => {
  const large = Array.from({ length: 2000 }, (_, index) => word(index + 1, `word-${index}`, `释义 ${index}`))
  const round = createQuizRound([...large, ...large], large, stableRandom)
  assert.equal(round.questions.length, large.length)
  assert.equal(round.wordCount, large.length)
})

test('small books use genuine available choices or spelling instead of invented distractors', () => {
  assert.equal(createQuizQuestion(vocabulary[0]!, vocabulary.slice(0, 2), 'en-zh').options.length, 2)
  assert.equal(createQuizQuestion(vocabulary[0]!, vocabulary.slice(0, 3), 'en-zh').options.length, 3)
  const single = createQuizQuestion(vocabulary[0]!, [vocabulary[0]!, word(9, 'realize', 'v. 实现')], 'en-zh')
  assert.equal(single.kind, 'typing')
  assert.equal(single.direction, 'zh-en')
  assert.deepEqual(single.options, [])
  assert.equal(normalizeSpelling(' ＡＣＨＩＥＶＥ  '), 'achieve')
})

test('requires a confirmed result before advancing and rejects duplicate/stale answers', () => {
  const round = createQuizRound(vocabulary, vocabulary, stableRandom)
  assert.equal(advanceQuizRound(round), round)
  assert.equal(recordQuizAnswer(round, 'initial:999', true, vocabulary), round)
  const answered = recordQuizAnswer(round, 'initial:1', true, vocabulary)
  assert.equal(answered.cursor, 0)
  assert.equal(recordQuizAnswer(answered, 'initial:1', false, vocabulary), answered)
  assert.equal(advanceQuizRound(answered).cursor, 1)
})

test('mistakes append one correction at the end and do not overwrite first-pass results', () => {
  let round = createQuizRound(vocabulary.slice(0, 2), vocabulary, stableRandom)
  round = recordQuizAnswer(round, 'initial:1', false, vocabulary, stableRandom)
  assert.deepEqual(round.questions.map(question => question.key), ['initial:1', 'initial:2', 'correction:1'])
  assert.equal(round.questions[2]!.direction, 'zh-en')
  round = advanceQuizRound(round)
  round = advanceQuizRound(recordQuizAnswer(round, 'initial:2', true, vocabulary))
  round = recordQuizAnswer(round, 'correction:1', false, vocabulary)
  assert.equal(round.questions.length, 3)
  assert.deepEqual(summarizeQuizRound(round), { answered: 2, correct: 1, mistakes: 1, corrected: 0, correctionCount: 1 })
  assert.equal(advanceQuizRound(round).cursor, 3)
})

test('successful correction is separate from first-pass learning statistics', () => {
  let round = createQuizRound([vocabulary[0]!], vocabulary, stableRandom)
  round = advanceQuizRound(recordQuizAnswer(round, 'initial:1', false, vocabulary))
  round = recordQuizAnswer(round, 'correction:1', true, vocabulary)
  assert.deepEqual(summarizeQuizRound(round), { answered: 1, correct: 0, mistakes: 1, corrected: 1, correctionCount: 1 })
})

test('first-pass progress never grows its goal when mistakes add correction questions', () => {
  let round = createQuizRound(vocabulary.slice(0, 2), vocabulary, stableRandom)
  assert.deepEqual(quizProgress(round), { phase: 'practice', completed: 0, total: 2 })
  round = recordQuizAnswer(round, 'initial:1', false, vocabulary)
  assert.deepEqual(quizProgress(round), { phase: 'practice', completed: 1, total: 2 })
  round = advanceQuizRound(round)
  round = recordQuizAnswer(round, 'initial:2', true, vocabulary)
  assert.deepEqual(quizProgress(round), { phase: 'practice', completed: 2, total: 2 })
  round = advanceQuizRound(round)
  assert.deepEqual(quizProgress(round), { phase: 'correction', completed: 0, total: 1 })
  round = recordQuizAnswer(round, 'correction:1', true, vocabulary)
  assert.deepEqual(quizProgress(round), { phase: 'correction', completed: 1, total: 1 })
  assert.deepEqual(quizProgress(advanceQuizRound(round)), { phase: 'complete', completed: 2, total: 2 })
})
