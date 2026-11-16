import assert from 'node:assert/strict'
import { test } from 'node:test'
import { enqueueFavoriteMutation, readFavoriteIntent } from '../src/lib/favorite-mutations.ts'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

test('serializes delayed writes across screens and suppresses the older cache result', async () => {
  const scope = {}
  const firstResponse = deferred()
  const firstStarted = deferred()
  const secondResponse = deferred()
  const secondStarted = deferred()
  const calls: boolean[] = []
  let server = false
  let cache = false
  const first = enqueueFavoriteMutation({ scope, userId: 1, wordId: 8, epoch: 0, favorite: true, isCurrent: () => true, send: async favorite => {
    calls.push(favorite); server = favorite; firstStarted.resolve(); await firstResponse.promise
  } })
  await firstStarted.promise
  const second = enqueueFavoriteMutation({ scope, userId: 1, wordId: 8, epoch: 0, favorite: false, isCurrent: () => true, send: async favorite => {
    calls.push(favorite); server = favorite; secondStarted.resolve(); await secondResponse.promise
  } })
  assert.equal(readFavoriteIntent(scope, 1, 8, 0, true), false)
  assert.deepEqual(calls, [true])
  firstResponse.resolve()
  await first.result
  if (first.isLatest()) cache = true
  first.release()
  await secondStarted.promise
  assert.deepEqual(calls, [true, false])
  assert.equal(cache, false)
  secondResponse.resolve()
  assert.deepEqual(await second.result, { saved: true, cancelled: false })
  assert.equal(second.isLatest(), true)
  if (second.isLatest()) cache = false
  second.release()
  assert.equal(server, false)
  assert.equal(cache, false)
  assert.equal(readFavoriteIntent(scope, 1, 8, 0, true), true)
})

test('does not send queued requests from an identity epoch that was replaced', async () => {
  const scope = {}
  let epoch = 1
  const response = deferred()
  const started = deferred()
  const calls: boolean[] = []
  const first = enqueueFavoriteMutation({ scope, userId: 1, wordId: 8, epoch: 1, favorite: true, isCurrent: () => epoch === 1, send: async value => { calls.push(value); started.resolve(); await response.promise } })
  await started.promise
  const oldQueued = enqueueFavoriteMutation({ scope, userId: 1, wordId: 8, epoch: 1, favorite: false, isCurrent: () => epoch === 1, send: async value => { calls.push(value) } })
  epoch = 3 // The same user returned after switching to another account.
  const newIdentity = enqueueFavoriteMutation({ scope, userId: 1, wordId: 8, epoch: 3, favorite: true, isCurrent: () => epoch === 3, send: async value => { calls.push(value) } })
  response.resolve()
  await first.result
  assert.equal(first.isLatest(), false)
  assert.deepEqual(await oldQueued.result, { saved: false, cancelled: true })
  assert.deepEqual(await newIdentity.result, { saved: true, cancelled: false })
  assert.deepEqual(calls, [true, true])
  assert.equal(newIdentity.isLatest(), true)
  first.release(); oldQueued.release(); newIdentity.release()
})
