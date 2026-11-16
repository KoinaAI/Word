/** A revision identifies an edit even if its text later returns to an earlier value. */
export type SavedDraft<T> = { format: 1; baseline: T; value: T; revision?: string }

type DraftStorage = Pick<Storage, 'getItem' | 'removeItem'>

/** Compare JSON-compatible snapshots without depending on object property order. */
export function sameDraft(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => sameDraft(value, right[index]))
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord)
  const rightKeys = Object.keys(rightRecord)
  return leftKeys.length === rightKeys.length && leftKeys.every(key => Object.hasOwn(rightRecord, key) && sameDraft(leftRecord[key], rightRecord[key]))
}

/** Complete only the submitted revision, leaving later edits and unreadable stores intact. */
export function clearSubmittedDraft<T>(storage: DraftStorage, key: string, submitted: SavedDraft<T>): boolean {
  try {
    const current = storage.getItem(key)
    if (current === null || !sameDraft(JSON.parse(current), submitted)) return false
    storage.removeItem(key)
    return true
  } catch {
    return false
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Adopt confirmed values while retaining edits made after this save was submitted. */
export function rebaseCompletedDraft<T>(current: SavedDraft<T>, submitted: SavedDraft<T>, next: T): SavedDraft<T> | null {
  if (!sameDraft(current.baseline, submitted.baseline)) return null
  if (sameDraft(current, submitted)) return { ...current, baseline: next, value: next }
  let value = current.value
  if (isPlainRecord(current.value) && isPlainRecord(submitted.value) && isPlainRecord(next)) {
    const currentRecord = current.value
    const submittedRecord = submitted.value
    const nextRecord = next
    const fields = new Set([...Object.keys(currentRecord), ...Object.keys(submittedRecord), ...Object.keys(nextRecord)])
    const merged: Record<string, unknown> = {}
    for (const field of fields) {
      const edited = Object.hasOwn(currentRecord, field) !== Object.hasOwn(submittedRecord, field)
        || !sameDraft(currentRecord[field], submittedRecord[field])
      const source = edited ? currentRecord : nextRecord
      if (Object.hasOwn(source, field)) merged[field] = source[field]
    }
    value = merged as T
  }
  return { ...current, baseline: next, value }
}
