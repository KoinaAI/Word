export type SessionCookieLockMode = 'unknown' | 'web-locks' | 'indexeddb' | 'unavailable'
type CookieTask<T> = (locked: boolean, signal: AbortSignal) => Promise<T>
type LockEnvironment = { locks?: LockManager; indexedDB?: IDBFactory }

const databaseName = 'word-session-cookie-lock'
const storeName = 'requests'
let lockMode: SessionCookieLockMode = 'unknown'

/** The last available coordination mechanism, so restricted-storage UIs can explain renewal limits. */
export function getSessionCookieLockMode(): SessionCookieLockMode { return lockMode }

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}

/**
 * Serialize cookie-setting identity requests across tabs. Web Locks also cover
 * response parsing; on ordinary HTTP origins an IndexedDB readwrite transaction
 * provides the same exclusive scope until the task settles. If both browser
 * facilities are unavailable, login remains usable but locked=false forbids
 * sending a renewal Cookie from an uncoordinated identity read.
 */
export async function withSessionCookieLock<T>(signal: AbortSignal, task: CookieTask<T>, environment?: LockEnvironment): Promise<T> {
  if (signal.aborted) throw abortReason(signal)
  const available: LockEnvironment = environment ?? {}
  if (!environment) {
    // Storage getters themselves can throw in restricted browser contexts.
    try { available.locks = typeof navigator !== 'undefined' ? navigator.locks : undefined } catch { /* unavailable */ }
    try { available.indexedDB = typeof indexedDB !== 'undefined' ? indexedDB : undefined } catch { /* unavailable */ }
  }
  if (available.locks) {
    // Never switch lock mechanisms after a Web Lock rejection: another tab
    // could still own that mechanism while an IDB fallback runs independently.
    return available.locks.request('word-session-cookie', { signal }, () => {
      lockMode = 'web-locks'
      return task(true, signal)
    })
  }
  if (available.indexedDB) {
    const database = await openLockDatabase(available.indexedDB, signal)
    if (database) {
      lockMode = 'indexeddb'
      try { return await withDatabaseLock(database, signal, task) }
      finally { database.close() }
    }
  }
  if (signal.aborted) throw abortReason(signal)
  lockMode = 'unavailable'
  return task(false, signal)
}

function openLockDatabase(factory: IDBFactory, signal: AbortSignal): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    let settled = false
    let request: IDBOpenDBRequest
    const finish = (database: IDBDatabase | null, error?: unknown) => {
      if (settled) { database?.close(); return }
      settled = true
      signal.removeEventListener('abort', abort)
      if (error !== undefined) reject(error)
      else resolve(database)
    }
    const abort = () => finish(null, abortReason(signal))
    signal.addEventListener('abort', abort, { once: true })
    try { request = factory.open(databaseName, 1) }
    catch { finish(null); return }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName)
    }
    request.onerror = () => finish(null)
    // Another tab may be completing an upgrade. Wait for it or the caller's
    // deadline instead of starting an uncoordinated request while it owns data.
    request.onblocked = () => {}
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => database.close()
      finish(database)
    }
  })
}

function withDatabaseLock<T>(database: IDBDatabase, signal: AbortSignal, task: CookieTask<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController()
    let transaction: IDBTransaction
    let started = false
    let finished = false
    let outcome: { value: T } | { error: unknown } | undefined
    let databaseFailure: unknown
    const abort = () => {
      controller.abort(abortReason(signal))
      if (!started) {
        try { transaction.abort() } catch { /* A completed transaction no longer owns the lock. */ }
      }
      // Once started, the task observes this signal and settles before the
      // keepalive ends. Releasing a lock immediately on abort could allow a
      // second cookie request while the first fetch still receives headers.
    }
    const finish = () => {
      if (finished || !outcome) return
      finished = true
      signal.removeEventListener('abort', abort)
      if (databaseFailure !== undefined) reject(databaseFailure)
      else if ('error' in outcome) reject(outcome.error)
      else resolve(outcome.value)
    }
    try { transaction = database.transaction(storeName, 'readwrite') }
    catch (error) { reject(error); return }
    signal.addEventListener('abort', abort, { once: true })
    transaction.oncomplete = () => {
      if (!outcome) {
        databaseFailure = new Error('账号会话锁提前释放，请重试。')
        controller.abort(databaseFailure)
        if (!started) outcome = { error: databaseFailure }
      }
      finish()
    }
    transaction.onabort = () => {
      databaseFailure = signal.aborted ? abortReason(signal) : transaction.error ?? new Error('账号会话锁中断，请重试。')
      controller.abort(databaseFailure)
      if (!started) outcome = { error: databaseFailure }
      finish()
    }
    transaction.onerror = () => {
      // onabort owns error delivery; the original request is never replayed.
      controller.abort(transaction.error ?? new Error('账号会话锁失效，请重试。'))
    }
    const keepAlive = () => {
      let request: IDBRequest
      try { request = transaction.objectStore(storeName).get('identity') }
      catch (error) {
        databaseFailure = error
        controller.abort(error)
        if (!started) outcome = { error }
        try { transaction.abort() } catch { /* It may already have ended. */ }
        finish()
        return
      }
      request.onsuccess = () => {
        if (!outcome) keepAlive()
        if (started || finished || outcome || databaseFailure !== undefined || controller.signal.aborted || signal.aborted) return
        started = true
        Promise.resolve().then(() => task(true, controller.signal)).then(
          value => { outcome = { value }; if (databaseFailure !== undefined) finish() },
          error => { outcome = { error }; if (databaseFailure !== undefined) finish() },
        )
      }
    }
    keepAlive()
    if (signal.aborted) abort()
  })
}
