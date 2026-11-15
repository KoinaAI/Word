import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advanceLearnRound, createLearnRound, isLearnAnswerResponse, learnProgress, recordLearnAnswer, summarizeLearnRound } from '../src/lib/learn-round.ts'
import type { LearnAnswerResponse, LearnRound } from '../src/lib/learn-round.ts'
import type { Word } from '../src/lib/types.ts'

const word = (id: number, text: string, meaning: string): Word => ({ id, text, meaning, bookId: 1, phonetic: '', example: '', exampleMeaning: '', favorite: false, status: 'new', reinforce: false })
const vocabulary = [word(1, 'achieve', 'v. 达成；实现'), word(2, 'benefit', 'n. 益处；好处'), word(3, 'create', 'v. 创造'), word(4, 'demand', 'n. 需求')]
const stableRandom = () => 0.4
function acknowledge(round: LearnRound, correct: boolean): LearnRound {
  const question = round.questions[round.cursor]!
  const stage = correct ? question.learnStage + 1 : 0
  const response = { ok: true, learnStage: stage, learnRevision: question.learnRevision + 1, completed: stage === 2 } as LearnAnswerResponse
  return recordLearnAnswer(round, question.key, correct, response, vocabulary, stableRandom)
}
function answerAndAdvance(round: LearnRound, correct: boolean): LearnRound {
  return advanceLearnRound(acknowledge(round, correct))
}

test('interleaves two stages for every word and counts completion only after recall', () => {
  let round = createLearnRound(vocabulary.slice(0, 2), vocabulary, stableRandom)
  assert.deepEqual(round.questions.map(question => question.direction), ['en-zh', 'en-zh'])
  round = answerAndAdvance(round, true)
  assert.deepEqual(round.questions.map(question => [question.word.id, question.learnStage]), [[1, 0], [2, 0], [1, 1]])
  assert.deepEqual(learnProgress(round), { phase: 'practice', completed: 0, total: 2 })
  round = answerAndAdvance(round, true)
  assert.equal(round.questions[round.cursor]!.direction, 'zh-en')
  round = answerAndAdvance(round, true)
  assert.deepEqual(learnProgress(round), { phase: 'practice', completed: 1, total: 2 })
  round = answerAndAdvance(round, true)
  assert.deepEqual(learnProgress(round), { phase: 'complete', completed: 2, total: 2 })
  assert.deepEqual(summarizeLearnRound(round), { completed: 2, attempts: 4, correctAnswers: 4, restartedWords: 0, mistakes: [] })
})

test('errors in either stage reset only that word and can repeat without a retry limit', () => {
  let round = createLearnRound(vocabulary.slice(0, 2), vocabulary, stableRandom)
  round = answerAndAdvance(round, true) // A recognition
  round = answerAndAdvance(round, true) // B recognition
  round = answerAndAdvance(round, false) // A recall resets A
  assert.equal(round.questions.at(-1)!.word.id, 1)
  assert.equal(round.questions.at(-1)!.learnStage, 0)
  round = answerAndAdvance(round, true) // B recall completes B
  for (let index = 0; index < 4; index++) {
    assert.equal(round.questions[round.cursor]!.word.id, 1)
    assert.equal(round.questions[round.cursor]!.learnStage, 0)
    round = answerAndAdvance(round, false)
    assert.deepEqual(learnProgress(round), { phase: 'practice', completed: 1, total: 2 })
  }
  round = answerAndAdvance(round, true)
  assert.equal(round.questions[round.cursor]!.learnStage, 1)
  round = answerAndAdvance(round, true)
  const summary = summarizeLearnRound(round)
  assert.deepEqual(learnProgress(round), { phase: 'complete', completed: 2, total: 2 })
  assert.equal(summary.restartedWords, 1)
  assert.deepEqual(summary.mistakes.map(item => item.id), [1])
  assert.equal(summary.attempts, 10)
  assert.equal(summary.correctAnswers, 5)
})

test('advancing requires acknowledgement; stale, duplicate and inconsistent acknowledgements do not change state', () => {
  const round = createLearnRound([vocabulary[0]!], vocabulary, stableRandom)
  const question = round.questions[0]!
  const response = { ok: true, learnStage: 1, learnRevision: 1, completed: false } as const
  assert.equal(advanceLearnRound(round), round)
  assert.equal(recordLearnAnswer(round, 'learn:99:0', true, response, vocabulary), round)
  for (const invalid of [null, {}, { ...response, ok: false }, { ...response, learnStage: 2 }, { ...response, completed: true }, { ...response, learnRevision: 0 }, { ...response, learnRevision: 1.5 }]) {
    assert.equal(isLearnAnswerResponse(question, true, invalid), false)
    assert.equal(recordLearnAnswer(round, question.key, true, invalid, vocabulary), round)
  }
  const saved = recordLearnAnswer(round, question.key, true, response, vocabulary, stableRandom)
  assert.equal(recordLearnAnswer(saved, question.key, true, response, vocabulary), saved)
  assert.equal(recordLearnAnswer(saved, question.key, false, { ...response, learnStage: 0 }, vocabulary), saved)
  const next = advanceLearnRound(saved)
  assert.equal(recordLearnAnswer(next, question.key, true, response, vocabulary), next)
  const complete = acknowledge(next, true)
  assert.equal(complete.questions.length, 2)
  assert.equal(recordLearnAnswer(complete, next.questions[1]!.key, true, { ok: true, learnStage: 2, learnRevision: 2, completed: true }, vocabulary), complete)
  assert.equal(summarizeLearnRound(complete).completed, 1)
})

test('resumes saved recall stages, skips already completed words and deduplicates words', () => {
  const resumed = { ...vocabulary[0]!, learnStage: 1 as const, learnRevision: 5 }
  const restarted = { ...vocabulary[1]!, learnStage: 0 as const, learnRevision: 2 }
  const finished = { ...vocabulary[2]!, learnStage: 2 as const, learnRevision: 2 }
  let round = createLearnRound([resumed, resumed, restarted, finished], vocabulary, stableRandom)
  assert.equal(round.wordCount, 2)
  assert.equal(round.questions[0]!.direction, 'zh-en')
  assert.equal(round.questions[0]!.key, 'learn:1:5')
  assert.equal(round.questions[1]!.direction, 'en-zh')
  assert.equal(round.questions[1]!.correction, true)
  round = answerAndAdvance(round, true)
  assert.equal(summarizeLearnRound(round).completed, 1)
  assert.equal(round.questions.length, 2)
  const empty = createLearnRound([finished], vocabulary)
  assert.deepEqual(learnProgress(empty), { phase: 'complete', completed: 0, total: 0 })
})

test('one-word books keep recognition first and require spelling for recall without inventing options', () => {
  const onlyWord = vocabulary[0]!
  let round = createLearnRound([onlyWord], [onlyWord], stableRandom)
  const recognition = round.questions[0]!
  assert.equal(recognition.direction, 'en-zh')
  assert.equal(recognition.kind, 'choice')
  assert.deepEqual(recognition.options, [{ id: onlyWord.id, label: onlyWord.meaning }])
  const saved = { ok: true, learnStage: 1, learnRevision: 1, completed: false } as const
  round = advanceLearnRound(recordLearnAnswer(round, recognition.key, true, saved, [onlyWord], stableRandom))
  assert.equal(round.questions[round.cursor]!.direction, 'zh-en')
  assert.equal(round.questions[round.cursor]!.kind, 'typing')
  assert.deepEqual(round.questions[round.cursor]!.options, [])
})
