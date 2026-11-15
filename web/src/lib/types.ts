export type User = {
  id: number; name: string; email: string; role: 'user' | 'admin'; guest: boolean;
  dailyGoal: number; examDate: string; activeBookId: number;
}
export type Book = {
  id: number; title: string; subtitle: string; description: string; category: string;
  color: string; wordCount: number; learnedCount: number; dueCount: number;
}
export type Word = {
  id: number; bookId: number; text: string; phonetic: string; meaning: string;
  example: string; exampleMeaning: string; favorite: boolean;
  status: 'new' | 'learning' | 'mastered'; reinforce: boolean; dueAt?: string;
  learnStage?: 0 | 1 | 2; learnRevision?: number;
}
export type Mode = 'learn' | 'review' | 'sprint' | 'reinforce'
export type Answer = 'known' | 'unknown' | 'unsure-known' | 'unsure-unknown'
export type Study = { book: Book; words: Word[]; total: number }
export type Activity = { date: string; count: number }
export type Recent = { id: number; text: string; meaning: string; answer: string; createdAt: string }
export type Stats = {
  learned: number; due: number; reinforce: number; favorites: number; today: number;
  streak: number; totalWords: number; activity: Activity[]; recent: Recent[];
}
export type AdminStats = { users: number; books: number; words: number; answers: number; activeToday: number; activity: Activity[]; recent: Recent[] }
export type AdminUser = User & { learnedCount: number; createdAt: string }
export type Navigation = { id: string; label: string; path: string; icon: string; enabled: boolean; sortOrder: number }
