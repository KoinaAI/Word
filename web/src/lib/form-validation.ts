export type ImportWord = {
  text: string
  meaning: string
  phonetic?: string
  example?: string
  exampleMeaning?: string
}

/** Match the API's Unicode character limit rather than UTF-16 input length. */
export function validateProfileName(name: string): string | undefined {
  const normalized = name.trim()
  if (!normalized) return '请输入昵称。'
  if (Array.from(normalized).length > 40) return '昵称最多 40 个字。'
}

/** bcrypt accepts at most 72 UTF-8 bytes, which may be fewer than 72 characters. */
export function validatePassword(password: string, register: boolean): string | undefined {
  const bytes = new TextEncoder().encode(password).length
  if (!bytes) return '请输入密码。'
  if (register && bytes < 8) return '密码至少需要 8 个 UTF-8 字节。'
  if (bytes > 72) return '密码最多 72 个 UTF-8 字节，中文和其他非英文字符可能占多个字节。'
}

const optionalFields = ['phonetic', 'example', 'exampleMeaning'] as const
const fieldLimits = { text: 128, phonetic: 200, meaning: 2000, example: 2000, exampleMeaning: 2000 }
const fieldNames = { text: '单词', phonetic: '音标', meaning: '释义', example: '英文例句', exampleMeaning: '中文例句' }
const unsupportedControl = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/

function readField(record: Record<string, unknown>, field: keyof typeof fieldLimits, index: number): string {
  const label = `第 ${index + 1} 项的 ${field}（${fieldNames[field]}）`
  const raw = record[field]
  if (typeof raw !== 'string') throw new Error(`${label}必须是字符串。`)
  const value = raw.trim()
  if ((field === 'text' || field === 'meaning') && !value) throw new Error(`${label}不能为空。`)
  if (Array.from(value).length > fieldLimits[field]) throw new Error(`${label}最多 ${fieldLimits[field]} 个字符。`)
  if (unsupportedControl.test(value)) throw new Error(`${label}包含不支持的控制字符。`)
  // A lone surrogate cannot be preserved as valid UTF-8 by the API.
  if (Array.from(value).some(character => {
    const point = character.codePointAt(0)!
    return point >= 0xd800 && point <= 0xdfff
  })) throw new Error(`${label}包含无效的 Unicode 字符。`)
  return value
}

/** Validate an import before sending it; omitted optional fields must remain omitted. */
export function validateImportWords(source: string): ImportWord[] {
  let parsed: unknown
  try { parsed = JSON.parse(source) }
  catch { throw new Error('JSON 格式有误，请检查引号、逗号和括号。') }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && 'words' in parsed
      ? parsed.words
      : null
  if (!Array.isArray(list) || list.length === 0 || list.length > 5000) {
    throw new Error('请输入包含 1–5000 个单词的 JSON 数组，或 {"words": [...]}。')
  }

  const seen = new Map<string, number>()
  return list.map((item: unknown, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`第 ${index + 1} 项必须是单词对象。`)
    const record = item as Record<string, unknown>
    const word: ImportWord = { text: readField(record, 'text', index), meaning: readField(record, 'meaning', index) }
    for (const field of optionalFields) {
      if (record[field] !== undefined) word[field] = readField(record, field, index)
    }
    const key = word.text.toLowerCase()
    const previous = seen.get(key)
    if (previous !== undefined) throw new Error(`第 ${index + 1} 项的 text（${word.text}）与第 ${previous + 1} 项重复。`)
    seen.set(key, index)
    return word
  })
}
