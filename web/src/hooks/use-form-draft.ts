import { useEffect, useRef, useState } from 'react'

type SavedDraft<T> = { format: 1; baseline: T; value: T }

function matchesShape(value: unknown, sample: unknown): boolean {
  if (sample === null) return value === null
  if (typeof sample !== 'object') return typeof value === typeof sample
  if (Array.isArray(sample)) return Array.isArray(value) && (sample.length === 0 || value.every(item => matchesShape(item, sample[0])))
  return Boolean(value && typeof value === 'object' && Object.entries(sample).every(([field, example]) => matchesShape((value as Record<string, unknown>)[field], example)))
}

/** Keep unfinished forms and their original values isolated by account and resource. */
export function useFormDraft<T>(key: string, initial: T) {
  const [starting] = useState(() => {
    try {
      const saved = sessionStorage.getItem(key)
      if (saved) {
        const parsed = JSON.parse(saved) as SavedDraft<T>
        if (parsed.format === 1 && matchesShape(parsed.value, initial) && matchesShape(parsed.baseline, initial)) return { value: parsed.value, baseline: parsed.baseline, restored: true }
      }
    } catch { /* Editing remains available even when browser storage is blocked. */ }
    return { value: initial, baseline: initial, restored: false }
  })
  const baseline = useRef(starting.baseline)
  const [restored, setRestored] = useState(starting.restored)
  const [value, setValue] = useState(starting.value)
  const [storageError, setStorageError] = useState('')
  const dirty = JSON.stringify(value) !== JSON.stringify(baseline.current)
  const persist = () => {
    try {
      if (dirty) sessionStorage.setItem(key, JSON.stringify({ format: 1, baseline: baseline.current, value } satisfies SavedDraft<T>))
      else sessionStorage.removeItem(key)
      setStorageError('')
      return true
    } catch {
      setStorageError('浏览器无法保存草稿。请先复制需要保留的内容，再关闭页面。')
      return false
    }
  }
  useEffect(() => { persist() }, [dirty, key, value])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const reset = (next: T = baseline.current) => {
    baseline.current = next
    setValue(next)
    setRestored(false)
    setStorageError('')
    try { sessionStorage.removeItem(key) } catch { /* A successful server save is still confirmed. */ }
  }
  return { value, setValue, baseline: baseline.current, dirty, restored, storageError, persist, reset }
}
