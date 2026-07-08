// Connectivity as React state (member-app-offline D10): one hook over TanStack's
// onlineManager — the SAME signal that pauses/resumes the class (b) mutation queue,
// so the offline pill and the disabled online-only affordances can never disagree
// with replay behavior.
import { onlineManager } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

/**
 * Seed onlineManager from `navigator.onLine` — called by main.tsx before render.
 * v5's manager boots `online = true` and only flips on window online/offline EVENTS;
 * after an OFFLINE LAUNCH no event ever fires, so without this seed the queue would
 * not pause and the pill would not show on the airplane-mode boot path.
 * `navigator.onLine === false` reliably means offline (the true direction is the
 * unreliable one), so seeding false-only is safe.
 */
export function seedOnlineStateFromNavigator(): void {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    onlineManager.setOnline(false);
  }
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => onlineManager.subscribe(onChange),
    () => onlineManager.isOnline(),
    () => true,
  );
}
