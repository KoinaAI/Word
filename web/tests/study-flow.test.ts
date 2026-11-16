import assert from 'node:assert/strict'
import { test } from 'node:test'
import { completeStudyAnswer, createStudyRound, studyAnswer, summarizeStudyRound, undoStudyAnswer } from '../src/lib/study-flow.ts'
import type { Word } from '../src/lib/types.ts'

const words: Word[] = [1, 2].map(id => ({ id, bookId: 1, text: `word${id}`, meaning: `释义${id}`, phonetic: '', example: '', exampleMeaning: '', favorite: false, status: 'new', reinforce: false }))

test('sprint revelation changes only the positive destination and keeps unknown words available', () => {
  assert.equal(studyAnswer('sprint', false, 'known'), 'known')
  assert.equal(studyAnswer('sprint', true, 'known'), 'unsure-known')
  assert.equal(studyAnswer('sprint', true, 'unknown'), 'unsure-unknown')
  const initial = createStudyRound(words)
  const answered = completeStudyAnswer(initial, 1, 'unsure-unknown', 'first')
  assert.deepEqual(summarizeStudyRound(answered).unknown.map(word => word.id), [1])
  assert.equal(completeStudyAnswer(answered, 1, 'known', 'duplicate'), answered)
})

test('confirmed undo rewinds only the latest event and removes its summary effect', () => {
  let round = completeStudyAnswer(createStudyRound(words), 1, 'known', 'first')
  round = completeStudyAnswer(round, 2, 'unsure-known', 'second')
  assert.equal(undoStudyAnswer(round, 'first'), round)
  assert.equal(undoStudyAnswer(round, 'unknown-event'), round)
  const undone = undoStudyAnswer(round, 'second')
  assert.equal(undone.cursor, 1)
  assert.equal(undone.words[undone.cursor]?.id, 2)
  assert.equal(undone.results.length, 1)
  assert.deepEqual(summarizeStudyRound(undone), { known: 1, reinforce: 0, unknown: [] })
  assert.equal(undoStudyAnswer(undone, 'second'), undone)
  const corrected = completeStudyAnswer(undone, 2, 'unknown', 'corrected')
  assert.equal(corrected.cursor, 2)
  assert.deepEqual(summarizeStudyRound(corrected).unknown.map(word => word.id), [2])
})
