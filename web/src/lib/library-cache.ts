function patchWords(words: unknown[], wordId: number, favorite: boolean): unknown[] {
  let result = words
  for (let index = 0; index < words.length; index++) {
    const word: unknown = words[index]
    if (!word || typeof word !== 'object' || Array.isArray(word)) continue
    const record = word as Record<string, unknown>
    if (record.id !== wordId || typeof record.favorite !== 'boolean' || record.favorite === favorite) continue
    if (result === words) result = [...words]
    result[index] = { ...record, favorite }
  }
  return result
}

/** Update one word's favorite in a list or words/items envelope without changing unrelated cache data. */
export function patchWordFavorite<T>(data: T | undefined, wordId: number, favorite: boolean): T | undefined {
  if (Array.isArray(data)) return patchWords(data, wordId, favorite) as T
  if (!data || typeof data !== 'object') return data
  const record = data as Record<string, unknown>
  let result = record
  for (const key of ['words', 'items'] as const) {
    const words = record[key]
    if (!Array.isArray(words)) continue
    const next = patchWords(words, wordId, favorite)
    if (next === words) continue
    if (result === record) result = { ...record }
    result[key] = next
  }
  return result as T
}
