import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { User } from './types'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}
/** Same-origin cookie authentication; errors remain visible to the calling screen. */
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin', ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  })
  const payload = await response.json().catch(() => ({ error: '服务返回了无效响应，请稍后再试。' }))
  if (!response.ok) throw new ApiError(payload.error || '请求失败，请稍后再试。', response.status)
  return payload as T
}
export const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
export function useUser() {
  return useQuery<User>({
    queryKey: ['me'], staleTime: Infinity, retry: false,
    queryFn: async () => {
      try { return await api<User>('/me') }
      catch (error) {
        if (error instanceof ApiError && error.status === 401) return api<User>('/auth/guest', json('POST'))
        throw error
      }
    },
  })
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
