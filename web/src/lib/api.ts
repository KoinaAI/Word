import { QueryClient, useQuery } from "@tanstack/react-query";

export type User = {
  id: number;
  name: string;
  email: string;
  role: "user" | "admin";
  guest: boolean;
  dailyGoal: number;
  examDate: string;
  activeBookId: number;
};
export type Book = {
  id: number;
  title: string;
  subtitle: string;
  description: string;
  category: string;
  color: string;
  wordCount: number;
  learnedCount: number;
  dueCount: number;
};
export type Word = {
  id: number;
  bookId: number;
  text: string;
  phonetic: string;
  meaning: string;
  example: string;
  exampleMeaning: string;
  favorite: boolean;
  status: "new" | "learning" | "mastered";
  reinforce: boolean;
  dueAt?: string;
};
export type Activity = { date: string; count: number };
export type Recent = {
  id: number;
  text: string;
  meaning: string;
  answer: string;
  createdAt: string;
};
export type Stats = {
  learned: number;
  due: number;
  reinforce: number;
  favorites: number;
  today: number;
  streak: number;
  totalWords: number;
  activity: Activity[];
  recent: Recent[];
};
export type AdminStats = {
  users: number;
  books: number;
  words: number;
  answers: number;
  activeToday: number;
  activity: Activity[];
  recent: Recent[];
};
export type Navigation = {
  id: string;
  label: string;
  path: string;
  icon: string;
  enabled: boolean;
  sortOrder: number;
};
export type StudyMode = "learn" | "review" | "sprint" | "reinforce";
export type Answer = "known" | "unknown" | "unsure-known" | "unsure-unknown";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      body.error || `请求失败 (${response.status})`,
      response.status,
    );
  return body as T;
}
export const send = <T>(path: string, body: unknown, method = "POST") =>
  api<T>(path, { method, body: JSON.stringify(body) });
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, error) =>
        !(error instanceof ApiError && error.status < 500) && count < 1,
      refetchOnWindowFocus: true,
    },
  },
});
export const useUser = () =>
  useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api<User>("/me");
      } catch (error) {
        if (error instanceof ApiError && error.status === 401)
          return send<User>("/auth/guest", {});
        throw error;
      }
    },
  });
export const useBooks = () =>
  useQuery({ queryKey: ["books"], queryFn: () => api<Book[]>("/books") });
export const useStats = () =>
  useQuery({ queryKey: ["stats"], queryFn: () => api<Stats>("/stats") });
export async function refreshLearning() {
  await Promise.all(
    ["stats", "books", "book", "favorites", "study"].map((key) =>
      queryClient.invalidateQueries({ queryKey: [key] }),
    ),
  );
}
export function speak(text: string) {
  if (!("speechSynthesis" in window)) return false;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 0.85;
  const voice = speechSynthesis.getVoices().find((v) => v.lang === "en-US");
  if (voice) utterance.voice = voice;
  speechSynthesis.speak(utterance);
  return true;
}
export const modeNames: Record<StudyMode, string> = {
  learn: "学习新词",
  review: "到期复习",
  sprint: "临考速刷",
  reinforce: "重点巩固",
};
