export type FavoriteMutationOutcome = { saved: boolean; cancelled: boolean; error?: unknown }
export type FavoriteMutation = {
  result: Promise<FavoriteMutationOutcome>
  isLatest: () => boolean
  release: () => void
}
type FavoriteIntent = { generation: number; epoch: number; favorite: boolean }
type FavoriteLane = { generation: number; tail: Promise<void>; intent?: FavoriteIntent }
const scopes = new WeakMap<object, Map<string, FavoriteLane>>()

function lanesFor(scope: object) {
  let lanes = scopes.get(scope)
  if (!lanes) { lanes = new Map(); scopes.set(scope, lanes) }
  return lanes
}

/** Read the latest queued intent when a new screen still has an earlier server snapshot. */
export function readFavoriteIntent(scope: object, userId: number, wordId: number, epoch: number, fallback: boolean): boolean {
  const intent = scopes.get(scope)?.get(`${userId}:${wordId}`)?.intent
  return intent?.epoch === epoch ? intent.favorite : fallback
}

/** Serialize one user's writes to a word across mounted screens; only the latest intent may update caches. */
export function enqueueFavoriteMutation({ scope, userId, wordId, epoch, favorite, isCurrent, send }: {
  scope: object; userId: number; wordId: number; epoch: number; favorite: boolean
  isCurrent: () => boolean; send: (favorite: boolean) => Promise<unknown>
}): FavoriteMutation {
  const lanes = lanesFor(scope)
  const key = `${userId}:${wordId}`
  let lane = lanes.get(key)
  if (!lane) { lane = { generation: 0, tail: Promise.resolve() }; lanes.set(key, lane) }
  const currentLane = lane
  const generation = ++currentLane.generation
  currentLane.intent = { generation, epoch, favorite }
  const isLatest = () => isCurrent() && currentLane.intent?.generation === generation && currentLane.intent.epoch === epoch
  const result = currentLane.tail.then(async (): Promise<FavoriteMutationOutcome> => {
    if (!isCurrent()) return { saved: false, cancelled: true }
    try { await send(favorite); return { saved: true, cancelled: false } }
    catch (error) { return { saved: false, cancelled: false, error } }
  })
  const settled = result.then(() => {})
  currentLane.tail = settled
  const cleanup = () => {
    if (currentLane.tail === settled && !currentLane.intent) lanes.delete(key)
  }
  void settled.then(cleanup)
  return {
    result,
    isLatest,
    release: () => {
      if (currentLane.intent?.generation === generation) currentLane.intent = undefined
      cleanup()
    },
  }
}
