import assert from 'node:assert/strict'
import { test } from 'node:test'
import { patchWordFavorite } from '../src/lib/library-cache.ts'

const first = { id: 1, text: 'achieve', favorite: false, meaning: '实现' }
const second = { id: 2, text: 'benefit', favorite: true, meaning: '益处' }

test('updates a word array without mutating the source or unrelated words', () => {
  const source = [first, second]
  const result = patchWordFavorite(source, 1, true)!
  assert.notEqual(result, source)
  assert.deepEqual(result[0], { ...first, favorite: true })
  assert.notEqual(result[0], first)
  assert.equal(result[1], second)
  assert.equal(first.favorite, false)
})

test('updates detail words while retaining metadata and other references', () => {
  const book = { id: 9, title: '词书' }
  const source = { book, words: [first, second], total: 20, hasMore: true }
  const result = patchWordFavorite(source, 1, true)!
  assert.notEqual(result, source)
  assert.equal(result.book, book)
  assert.equal(result.words[1], second)
  assert.equal(result.words[0]!.favorite, true)
  assert.equal(result.total, 20)
  assert.equal(result.hasMore, true)
  assert.equal(source.words[0]!.favorite, false)
})

test('updates paged items and leaves an unfavorited word in place until refetch', () => {
  const source = { items: [first, second], total: 2, offset: 0, limit: 50 }
  const result = patchWordFavorite(source, 2, false)!
  assert.deepEqual(result, { ...source, items: [first, { ...second, favorite: false }] })
  assert.equal(result.items[0], first)
  assert.equal(result.total, 2)
  assert.equal(source.items[1]!.favorite, true)
})

test('preserves cache identity when the word is absent or already has the requested state', () => {
  const words = [first, second]
  const detail = { words, total: 2 }
  assert.equal(patchWordFavorite(words, 99, true), words)
  assert.equal(patchWordFavorite(words, 1, false), words)
  assert.equal(patchWordFavorite(detail, 99, true), detail)
  assert.equal(patchWordFavorite(detail, 2, true), detail)
})

test('ignores undefined, empty and unknown cache shapes without traversing nested objects', () => {
  const unknown = { id: 1, favorite: false, nested: { items: [first] } }
  const malformed = { words: 'unavailable', items: [{ id: 1, title: '词书' }, null, 1] }
  const empty: unknown[] = []
  assert.equal(patchWordFavorite(undefined, 1, true), undefined)
  assert.equal(patchWordFavorite(null, 1, true), null)
  assert.equal(patchWordFavorite('unavailable', 1, true), 'unavailable')
  assert.equal(patchWordFavorite(empty, 1, true), empty)
  assert.equal(patchWordFavorite(unknown, 1, true), unknown)
  assert.equal(patchWordFavorite(malformed, 1, true), malformed)
})
