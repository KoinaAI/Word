import { useEffect, useSyncExternalStore } from 'react'
import { QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import type { User } from './types'

export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly details?: Record<string, unknown>
  constructor(message: string, status: number, code?: string, details?: Record<string, unknown>) {
    super(message); this.name = 'ApiError'; this.status = status; this.code = code; this.details = details
  }
}

type ApiOptions = RequestInit & { timeoutMs?: number }
type SessionSnapshot = { epoch: number; checking: boolean }
type AuthMessage = { nonce: string; userId: number | null }
const authStorageKey = 'word-auth-change'
const sessionListeners = new Set<() => void>()
const requests = new Set<AbortController>()
let expectedUserId: number | null | undefined
let sessionSnapshot: SessionSnapshot = { epoch: 0, checking: false }
let lastMessage = ''
let authChannel: BroadcastChannel | undefined

function emitSession() { for (const listener of sessionListeners) listener() }
function advanceSession(checking: boolean) {
  sessionSnapshot = { epoch: sessionSnapshot.epoch + 1, checking }
  for (const request of requests) request.abort()
  requests.clear()
  emitSession()
}
function invalidateSession() {
  if (sessionSnapshot.checking) return
  expectedUserId = undefined
  advanceSession(true)
}
function changedAccount() { return new ApiError('账号已发生变化，请等待重新连接后再操作。', 409, 'SESSION_CHANGED') }
function broadcastIdentity(userId: number | null) {
  const message: AuthMessage = { nonce: `${Date.now()}:${Math.random()}`, userId }
  lastMessage = message.nonce
  authChannel?.postMessage(message)
  try { localStorage.setItem(authStorageKey, JSON.stringify(message)) } catch { /* The channel still works when storage is unavailable. */ }
}
function receiveIdentity(value: unknown) {
  if (!value || typeof value !== 'object' || !('nonce' in value) || typeof value.nonce !== 'string' || value.nonce === lastMessage) return
  lastMessage = value.nonce
  // Messages never establish identity: the shared cookie must be checked with the server.
  invalidateSession()
}

/** Publish a completed login/logout after updating this tab's query cache. */
export function publishAuthChange(user: User | null) {
  expectedUserId = user?.id ?? null
  advanceSession(false)
  broadcastIdentity(expectedUserId)
}
/** Switch accounts atomically: stale responses cannot populate the new account's cache. */
export function syncAuthUser(client: QueryClient, user: User) {
  void client.cancelQueries()
  client.clear()
  publishAuthChange(user)
  client.setQueryData(['me'], user)
}
/** Remove the current identity after the server confirms logout. */
export function clearAuthSession(client: QueryClient) {
  void client.cancelQueries()
  client.clear()
  publishAuthChange(null)
}

/** Same-origin requests have a bounded wait and bind writes to the displayed account. */
export async function apiResponse<T>(path: string, options: ApiOptions = {}): Promise<{ data: T; headers: Headers }> {
  const { timeoutMs = 15_000, signal: callerSignal, ...init } = options
  const method = (init.method || 'GET').toUpperCase()
  const writing = !['GET', 'HEAD', 'OPTIONS'].includes(method)
  if (writing && sessionSnapshot.checking) throw changedAccount()
  const epoch = sessionSnapshot.epoch
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (writing && expectedUserId != null) headers.set('X-Word-User-ID', String(expectedUserId))
  const controller = new AbortController()
  let timedOut = false
  const abort = () => controller.abort(callerSignal?.reason)
  if (callerSignal?.aborted) abort()
  else callerSignal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
  requests.add(controller)
  try {
    const load = async () => {
      if (path === '/me' && typeof navigator !== 'undefined' && navigator.locks) headers.set('X-Word-Session-Renew', '1')
      const response = await fetch(`/api${path}`, { ...init, credentials: 'same-origin', headers, signal: controller.signal })
      const payload = await response.json().catch(() => ({ error: '服务返回了无效响应，请稍后再试。' }))
      return { response, payload }
    }
    // Cookie-setting requests share one cross-tab lock so a late renewal cannot undo a login.
    const cookieRequest = path === '/me' || path.startsWith('/auth/')
    const { response, payload } = cookieRequest && typeof navigator !== 'undefined' && navigator.locks
      ? await navigator.locks.request('word-session-cookie', { signal: controller.signal }, load)
      : await load()
    if (epoch !== sessionSnapshot.epoch) throw changedAccount()
    if (!response.ok) {
      if (payload.code === 'SESSION_CHANGED' || (path === '/me' && response.status === 401 && expectedUserId != null)) {
        invalidateSession()
        throw changedAccount()
      }
      throw new ApiError(payload.error || '请求失败，请稍后再试。', response.status, payload.code, payload)
    }
    if (path === '/me' || path === '/auth/guest') {
      const user = payload as User
      if (expectedUserId != null && expectedUserId !== user.id) {
        invalidateSession()
        throw changedAccount()
      }
      const firstIdentity = expectedUserId == null
      expectedUserId = user.id
      if (path === '/auth/guest' && firstIdentity) broadcastIdentity(user.id)
    }
    return { data: payload as T, headers: response.headers }
  } catch (error) {
    if (epoch !== sessionSnapshot.epoch) throw changedAccount()
    if (timedOut) throw new ApiError(writing ? '保存确认超时。结果可能已保存，请重试同一次操作以确认。' : '加载超时，请检查网络后重试。', 0, 'REQUEST_TIMEOUT')
    throw error
  } finally {
    clearTimeout(timeout)
    callerSignal?.removeEventListener('abort', abort)
    requests.delete(controller)
  }
}
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> { return (await apiResponse<T>(path, options)).data }
export const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

export function useUser() {
  return useQuery<User>({
    queryKey: ['me'], staleTime: 30_000, retry: false, refetchInterval: 60_000,
    queryFn: async ({ signal }) => {
      try { return await api<User>('/me', { signal }) }
      catch (error) {
        if (error instanceof ApiError && error.status === 401) return api<User>('/auth/guest', { ...json('POST'), signal })
        throw error
      }
    },
  })
}

/** Unmount old account screens before validating an identity changed in another tab. */
export function useSessionBoundary() {
  const client = useQueryClient()
  const snapshot = useSyncExternalStore(listener => { sessionListeners.add(listener); return () => sessionListeners.delete(listener) }, () => sessionSnapshot)
  useEffect(() => {
    if (typeof BroadcastChannel !== 'undefined') {
      authChannel = new BroadcastChannel('word-session')
      authChannel.onmessage = event => receiveIdentity(event.data)
    }
    const storage = (event: StorageEvent) => {
      if (event.key !== authStorageKey || !event.newValue) return
      try { receiveIdentity(JSON.parse(event.newValue)) } catch { /* Ignore malformed same-origin messages. */ }
    }
    const verify = () => {
      if (document.visibilityState === 'visible' && !sessionSnapshot.checking) void api('/me').catch(() => {})
    }
    window.addEventListener('storage', storage)
    window.addEventListener('focus', verify)
    document.addEventListener('visibilitychange', verify)
    return () => {
      window.removeEventListener('storage', storage)
      window.removeEventListener('focus', verify)
      document.removeEventListener('visibilitychange', verify)
      authChannel?.close(); authChannel = undefined
    }
  }, [])
  useEffect(() => {
    if (!snapshot.checking) return
    void client.cancelQueries()
    client.clear()
  }, [client, snapshot.epoch, snapshot.checking])
  return snapshot
}

/** Resolve a changed cookie without restoring any previous account's local state. */
export async function reconnectSession(client: QueryClient) {
  const epoch = sessionSnapshot.epoch
  try {
    const user = await api<User>('/me')
    if (epoch !== sessionSnapshot.epoch) return
    expectedUserId = user.id
    client.setQueryData(['me'], user)
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) throw error
    expectedUserId = null
  }
  if (epoch === sessionSnapshot.epoch) {
    sessionSnapshot = { epoch, checking: false }
    emitSession()
  }
}

export function useRefresh() {
  const client = useQueryClient()
  return () => Promise.all([
    client.invalidateQueries({ queryKey: ['stats'] }),
    client.invalidateQueries({ queryKey: ['books'] }),
    client.invalidateQueries({ queryKey: ['favorites'] }),
    client.invalidateQueries({ queryKey: ['admin'] }),
    client.invalidateQueries({ queryKey: ['study'] }),
  ])
}
