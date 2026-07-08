import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Compose class names with Tailwind-aware conflict resolution (the shadcn/ui `cn`). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
