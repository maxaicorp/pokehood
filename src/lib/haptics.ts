// Lightweight haptic feedback via the Vibration API.
//
// Works on Android Chrome/Brave/etc. iOS Safari does NOT support
// navigator.vibrate (Apple blocks it on the web), so this is a progressive
// enhancement — a no-op where unsupported, never throws. Respects the user's
// reduced-motion preference.

type HapticKind = "light" | "medium" | "success" | "error";

const PATTERNS: Record<HapticKind, number | number[]> = {
  light: 8,            // a tap (card flip, button press)
  medium: 18,          // a more deliberate action
  success: [10, 40, 18], // a match / confirmation
  error: [30, 30, 30], // a wrong action
};

let enabled: boolean | null = null;
function canVibrate(): boolean {
  if (enabled !== null) return enabled;
  enabled =
    typeof navigator !== "undefined" &&
    typeof navigator.vibrate === "function" &&
    !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  return enabled;
}

/** Fire a haptic pulse. Safe to call anywhere; no-ops on unsupported devices. */
export function haptic(kind: HapticKind = "light"): void {
  if (!canVibrate()) return;
  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    /* some browsers throw if called outside a user gesture — ignore */
  }
}
