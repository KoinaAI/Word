import { toast } from 'sonner'

export type PreferenceKey = 'word-accent' | 'word-auto-audio'
const memory = new Map<PreferenceKey, string>()
const volatile = new Set<PreferenceKey>()

/** Keep preferences usable when the browser blocks persistent storage. */
export function readPreference(key: PreferenceKey, fallback: string): string {
  if (volatile.has(key)) return memory.get(key) ?? fallback
  try {
    const value = localStorage.getItem(key)
    if (value !== null) memory.set(key, value)
    return value ?? memory.get(key) ?? fallback
  } catch {
    return memory.get(key) ?? fallback
  }
}

/** A failed persistent write still applies to this page session and is disclosed once. */
export function writePreference(key: PreferenceKey, value: string) {
  memory.set(key, value)
  try {
    localStorage.setItem(key, value)
    volatile.delete(key)
  } catch {
    volatile.add(key)
    toast.message('浏览器未允许保存偏好，此设置仅在本次使用中有效。', { id: 'word-preference-storage' })
  }
}
