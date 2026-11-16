import test from 'node:test'
import assert from 'node:assert/strict'
import { getSessionCookieLockMode, withSessionCookieLock } from '../src/lib/session-lock.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

// A deterministic IDB scheduler models exclusive readwrite transactions shared
// by independent connections. The helper still runs its real keepalive loop.
class DatabaseScheduler {
  current?: Transaction
  queue: Transaction[] = []
  failGetAt = 0
  readonly factory = {
    open: () => {
      const request = {} as IDBOpenDBRequest
      setImmediate(() => {
        Object.assign(request, { result: this.database() })
        request.onsuccess?.(new Event('success'))
      })
      return request
    },
  } as unknown as IDBFactory
  database() {
    return {
      close() {},
      transaction: () => {
        const transaction = new Transaction(this)
        this.queue.push(transaction)
        this.start()
        return transaction
      },
    } as unknown as IDBDatabase
  }
  start() {
    if (this.current || !this.queue.length) return
    this.current = this.queue.shift()!
    setImmediate(() => this.current?.pump())
  }
  release(transaction: Transaction) {
    if (this.current === transaction) this.current = undefined
    else this.queue = this.queue.filter(candidate => candidate !== transaction)
    this.start()
  }
}
class Transaction {
  oncomplete?: (event: Event) => void
  onabort?: (event: Event) => void
  onerror?: (event: Event) => void
  error: Error | null = null
  requests: Array<IDBRequest> = []
  done = false
  getCount = 0
  readonly scheduler: DatabaseScheduler
  constructor(scheduler: DatabaseScheduler) { this.scheduler = scheduler }
  objectStore() { return { get: () => { this.getCount++; if (this.getCount === this.scheduler.failGetAt) throw new Error('read failed'); const request = {} as IDBRequest; this.requests.push(request); return request } } }
  pump() {
    if (this.done || this.scheduler.current !== this) return
    const request = this.requests.shift()
    request?.onsuccess?.(new Event('success'))
    if (!this.requests.length) {
      this.done = true
      this.oncomplete?.(new Event('complete'))
      this.scheduler.release(this)
    } else setImmediate(() => this.pump())
  }
  abort() {
    if (this.done) return
    this.done = true
    setImmediate(() => { this.onabort?.(new Event('abort')); this.scheduler.release(this) })
  }
}

const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve))
const timeout = { timeout: 2000 }

test('IndexedDB keeps independent cookie tasks exclusive until response parsing settles', timeout, async () => {
  const scheduler = new DatabaseScheduler()
  const environment = { indexedDB: scheduler.factory }
  const firstStarted = deferred<void>()
  const firstBody = deferred<void>()
  const order: string[] = []
  const first = withSessionCookieLock(new AbortController().signal, async locked => {
    assert.equal(locked, true)
    order.push('first headers')
    firstStarted.resolve()
    await firstBody.promise
    order.push('first parsed')
    return 'first'
  }, environment)
  await firstStarted.promise
  const second = withSessionCookieLock(new AbortController().signal, async locked => {
    assert.equal(locked, true)
    order.push('second headers')
    return 'second'
  }, environment)
  await nextTurn(); await nextTurn()
  assert.deepEqual(order, ['first headers'])
  firstBody.resolve()
  assert.deepEqual(await Promise.all([first, second]), ['first', 'second'])
  assert.deepEqual(order, ['first headers', 'first parsed', 'second headers'])
  assert.equal(getSessionCookieLockMode(), 'indexeddb')
})

test('an aborted active fetch retains exclusivity until it settles', timeout, async () => {
  const scheduler = new DatabaseScheduler()
  const environment = { indexedDB: scheduler.factory }
  const controller = new AbortController()
  const started = deferred<void>()
  const settled = deferred<void>()
  let secondStarted = false
  const first = withSessionCookieLock(controller.signal, async (_locked, signal) => {
    started.resolve()
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
    await settled.promise
    throw signal.reason
  }, environment)
  const rejected = assert.rejects(first, { name: 'AbortError' })
  await started.promise
  const second = withSessionCookieLock(new AbortController().signal, async () => { secondStarted = true }, environment)
  controller.abort()
  await nextTurn(); await nextTurn()
  assert.equal(secondStarted, false)
  settled.resolve()
  await rejected
  await second
  assert.equal(secondStarted, true)
})

test('cancelled queued task never reaches the identity endpoint', timeout, async () => {
  const scheduler = new DatabaseScheduler()
  const environment = { indexedDB: scheduler.factory }
  const started = deferred<void>()
  const release = deferred<void>()
  const first = withSessionCookieLock(new AbortController().signal, async () => { started.resolve(); await release.promise }, environment)
  await started.promise
  const controller = new AbortController()
  let ran = false
  const second = withSessionCookieLock(controller.signal, async () => { ran = true }, environment)
  const rejected = assert.rejects(second, { name: 'AbortError' })
  await nextTurn()
  controller.abort()
  await rejected
  assert.equal(ran, false)
  release.resolve()
  await first
})

test('Web Locks is preferred and never retries a task failure', async () => {
  let calls = 0
  const locks = { request: async (_name: string, _options: unknown, task: () => unknown) => task() } as LockManager
  await assert.rejects(withSessionCookieLock(new AbortController().signal, async locked => {
    calls++; assert.equal(locked, true); throw new Error('response lost')
  }, { locks }), /response lost/)
  assert.equal(calls, 1)
  assert.equal(getSessionCookieLockMode(), 'web-locks')
})

test('unavailable storage preserves login while prohibiting unsafe renewal', async () => {
  const output = await withSessionCookieLock(new AbortController().signal, async locked => { assert.equal(locked, false); return 'login' }, {})
  assert.equal(output, 'login')
  assert.equal(getSessionCookieLockMode(), 'unavailable')
})

test('a rejected Web Lock never switches to an independent lock mechanism', async () => {
  let ran = false
  const locks = { request: async () => { throw new Error('lock request denied') } } as unknown as LockManager
  const indexedDB = { open: () => { throw new Error('must not open fallback') } } as unknown as IDBFactory
  await assert.rejects(withSessionCookieLock(new AbortController().signal, async () => { ran = true }, { locks, indexedDB }), /lock request denied/)
  assert.equal(ran, false)
})

test('keepalive failure before task start aborts without calling the endpoint', async () => {
  const scheduler = new DatabaseScheduler()
  scheduler.failGetAt = 2
  let ran = false
  await assert.rejects(withSessionCookieLock(new AbortController().signal, async () => { ran = true }, { indexedDB: scheduler.factory }), /read failed/)
  assert.equal(ran, false)
})
