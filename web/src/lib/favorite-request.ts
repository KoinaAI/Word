export type FavoriteSnapshot = { favorite: boolean; revision: number; wordId?: number }
type FavoriteRequest = <T>(path: string, options?: RequestInit) => Promise<T>

function statusOf(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : undefined
}

/** Fence every desired value with a fresh server revision, including no-op values after an uncertain save. */
export async function saveFavoriteCAS(request: FavoriteRequest, wordId: number, favorite: boolean, isCurrent: () => boolean): Promise<FavoriteSnapshot> {
  const current = () => { if (!isCurrent()) throw new Error('账号已发生变化，请重新连接后操作。') }
  let failure: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    current()
    const snapshot = await request<FavoriteSnapshot>(`/favorites/${wordId}`)
    current()
    try {
      const saved = await request<FavoriteSnapshot>(`/favorites/${wordId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favorite, expectedRevision: snapshot.revision }),
      })
      current()
      return saved
    } catch (error) {
      current()
      const status = statusOf(error)
      if (status !== 409 && status !== 0) throw error
      failure = error
    }
  }
  throw failure ?? new Error('收藏状态持续变化，请重新加载后再试。')
}
