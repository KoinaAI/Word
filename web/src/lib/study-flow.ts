import type { Answer, Mode, Word } from './types.ts'

export type StudyDecision = 'known' | 'unknown'
export type StudyResult = { word: Word; answer: Answer; eventId: string }
export type StudyRound = { words: Word[]; cursor: number; results: StudyResult[]; number: number }

/** Keep a stable queue for this round even when other queries refresh. */
export function createStudyRound(words: Word[], number = 1): StudyRound {
  return { words: words.map(word => ({ ...word })), cursor: 0, results: [], number }
}

/** Looking at a sprint definition changes the destination of a positive answer. */
export function studyAnswer(mode: Mode, revealed: boolean, decision: StudyDecision): Answer | null {
  if (mode !== 'sprint') return revealed ? decision : null
  return revealed ? `unsure-${decision}` : decision
}

/** Advance only the exact word whose server response has been confirmed. */
export function completeStudyAnswer(round: StudyRound, wordId: number, answer: Answer, eventId = ''): StudyRound {
  const word = round.words[round.cursor]
  if (!word || word.id !== wordId) return round
  return { ...round, cursor: round.cursor + 1, results: [...round.results, { word, answer, eventId }] }
}

/** Rewind only the last locally displayed answer after the server confirms the same event. */
export function undoStudyAnswer(round: StudyRound, eventId: string): StudyRound {
  const last = round.results.at(-1)
  if (!last || last.eventId !== eventId || round.cursor !== round.results.length) return round
  return { ...round, cursor: round.cursor - 1, results: round.results.slice(0, -1) }
}

export function summarizeStudyRound(round: StudyRound) {
  return {
    known: round.results.filter(result => result.answer === 'known').length,
    reinforce: round.results.filter(result => result.answer === 'unsure-known').length,
    unknown: round.results.filter(result => result.answer === 'unknown' || result.answer === 'unsure-unknown').map(result => result.word),
  }
}

/** UUIDs also work on HTTP LAN deployments, where randomUUID requires a secure context. */
export function createStudyEventId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
