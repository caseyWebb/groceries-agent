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

/**
 * Suspend the class (b) queue across a login submission (member-app-offline D9
 * amendment): a stamp-mismatch purge can only run once the session POST resolves —
 * before that, the target tenant is unknown — so without suspending first, the shared
 * `class-b-writes` mutation scope could dispatch a PRIOR member's queued write under
 * the NEW member's fresh cookie in the gap between the response landing and the purge
 * (a cross-tenant replay). `login.tsx` calls this before POSTing whenever the device
 * already carries a tenant stamp (a stampless device has nothing queued to leak).
 */
export function suspendQueue(): void {
  onlineManager.setOnline(false);
}

/** Restore onlineManager after a `suspendQueue()` window — navigator-truthful, same
 *  posture as `seedOnlineStateFromNavigator`: it never forces `true` when the device
 *  is actually offline. */
export function restoreQueue(): void {
  onlineManager.setOnline(typeof navigator === "undefined" || navigator.onLine);
}
