import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
export const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "操作失败，请重试";
