import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

/** Keep unfinished forms in this tab, isolated by account and resource. */
export function useFormDraft<T>(key: string, initial: T) {
  const baseline = useRef(initial)
  const [restored, setRestored] = useState(false)
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = sessionStorage.getItem(key)
      if (saved) return JSON.parse(saved) as T
    } catch { /* A blocked or full browser store must not stop editing. */ }
    return initial
  })
  const dirty = JSON.stringify(value) !== JSON.stringify(baseline.current)
  useEffect(() => {
    try { setRestored(sessionStorage.getItem(key) !== null) } catch { /* Optional recovery. */ }
  }, [key])
  useEffect(() => {
    try {
      if (dirty) sessionStorage.setItem(key, JSON.stringify(value))
      else sessionStorage.removeItem(key)
    } catch { /* Editing remains available if the browser quota is reached. */ }
  }, [dirty, key, value])
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
    try { sessionStorage.removeItem(key) } catch { /* Optional recovery. */ }
  }
  return { value, setValue: setValue as Dispatch<SetStateAction<T>>, dirty, restored, reset }
}
