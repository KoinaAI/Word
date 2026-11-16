import { useEffect, useRef, useState, type SetStateAction } from 'react'
import { clearSubmittedDraft, rebaseCompletedDraft, sameDraft, type SavedDraft } from '@/lib/draft-completion'

type DraftSubmission<T> = { snapshot: SavedDraft<T>; request: symbol }
type DraftCompletion<T> = { key: string; snapshot: SavedDraft<T>; next: T; request: symbol }
const completionEvent = 'word-draft-completed'
const activeOwners = new Map<string, symbol>()
const completedDrafts = new Map<string, DraftCompletion<unknown>>()
let revisionSequence = 0
const nextRevision = () => `${Date.now().toString(36)}-${(++revisionSequence).toString(36)}`

function matchesShape(value: unknown, sample: unknown): boolean {
  if (sample === null) return value === null
  if (typeof sample !== 'object') return typeof value === typeof sample
  if (Array.isArray(sample)) return Array.isArray(value) && (sample.length === 0 || value.every(item => matchesShape(item, sample[0])))
  return Boolean(value && typeof value === 'object' && Object.entries(sample).every(([field, example]) => matchesShape((value as Record<string, unknown>)[field], example)))
}

/** Retain drafts without allowing an old request to change a reopened editor. */
export function useFormDraft<T>(key: string, initial: T) {
  const [starting] = useState<{ record: SavedDraft<T>; restored: boolean }>(() => {
    try {
      const saved = sessionStorage.getItem(key)
      if (saved) {
        const parsed = JSON.parse(saved) as SavedDraft<T>
        if (parsed.format === 1 && matchesShape(parsed.value, initial) && matchesShape(parsed.baseline, initial)) return { record: parsed, restored: true }
      }
    } catch { /* Editing remains available even when browser storage is blocked. */ }
    return { record: { format: 1, baseline: initial, value: initial, revision: nextRevision() }, restored: false }
  })
  const record = useRef(starting.record)
  const owner = useRef(Symbol(key))
  const mounted = useRef(false)
  const request = useRef<symbol | null>(null)
  const pendingRequest = useRef<symbol | null>(null)
  const [restored, setRestored] = useState(starting.restored)
  const [value, setStateValue] = useState(starting.record.value)
  const [storageError, setStorageError] = useState('')
  const isActive = () => mounted.current && activeOwners.get(key) === owner.current
  const dirty = !sameDraft(value, record.current.baseline)
  const persist = () => {
    const current = record.current
    const changed = !sameDraft(current.value, current.baseline)
    try {
      if (changed) sessionStorage.setItem(key, JSON.stringify(current))
      else sessionStorage.removeItem(key)
      if (isActive()) setStorageError('')
      return true
    } catch {
      if (isActive()) setStorageError(changed ? '浏览器无法保存草稿。请先复制需要保留的内容，再关闭页面。' : '')
      // A clean editor has no new content to lose and must always be dismissible.
      return !changed
    }
  }
  const setValue = (update: SetStateAction<T>) => {
    if (!isActive()) return
    const next = typeof update === 'function' ? (update as (previous: T) => T)(record.current.value) : update
    record.current = { ...record.current, value: next, revision: nextRevision() }
    setStateValue(next)
    persist()
  }
  const adopt = (next: T) => {
    record.current = { format: 1, baseline: next, value: next, revision: nextRevision() }
    setStateValue(next)
    setRestored(false)
    setStorageError('')
  }
  useEffect(() => {
    mounted.current = true
    activeOwners.set(key, owner.current)
    const receive = (event: Event) => {
      const completion = (event as CustomEvent<DraftCompletion<T>>).detail
      if (!isActive() || completion.key !== key || pendingRequest.current && pendingRequest.current !== completion.request) return
      const rebased = rebaseCompletedDraft(record.current, completion.snapshot, completion.next)
      if (!rebased) return
      record.current = { ...rebased, revision: nextRevision() }
      setStateValue(rebased.value)
      setRestored(false)
      persist()
    }
    window.addEventListener(completionEvent, receive)
    const completed = completedDrafts.get(key)
    if (completed && starting.restored) receive(new CustomEvent(completionEvent, { detail: completed }))
    return () => {
      mounted.current = false
      if (activeOwners.get(key) === owner.current) activeOwners.delete(key)
      window.removeEventListener(completionEvent, receive)
    }
  }, [key])
  useEffect(() => { if (isActive()) persist() }, [key, value])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const reset = (next: T = record.current.baseline) => {
    if (!isActive()) return
    adopt(next)
    persist()
  }
  const beginSubmission = (): DraftSubmission<T> => {
    record.current = { ...record.current, revision: nextRevision() }
    persist()
    request.current = Symbol('draft request')
    pendingRequest.current = request.current
    return { snapshot: structuredClone(record.current), request: request.current }
  }
  const isCurrentSubmission = (submission: DraftSubmission<T>) => isActive() && request.current === submission.request
  const finishSubmission = (submission: DraftSubmission<T>) => {
    if (pendingRequest.current === submission.request) pendingRequest.current = null
  }
  const completeSubmission = (submission: DraftSubmission<T>, next: T) => {
    // A reopened editor keeps the original revision until it is edited. Only that
    // exact submitted record may be cleared, including after the sender unmounts.
    try { clearSubmittedDraft(sessionStorage, key, submission.snapshot) } catch { /* Reading the storage property itself may be forbidden. */ }
    const completed = { key, snapshot: submission.snapshot, next, request: submission.request }
    completedDrafts.set(key, completed)
    window.dispatchEvent(new CustomEvent<DraftCompletion<T>>(completionEvent, { detail: completed }))
    finishSubmission(submission)
  }
  return { value, setValue, baseline: record.current.baseline, dirty, restored, storageError, persist, reset, beginSubmission, isCurrentSubmission, finishSubmission, completeSubmission }
}
