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

// Interactive elements that should give a tap pulse — covers "anything a user
// can do" without wiring every onClick. Anchors, buttons, role-based controls,
// form toggles, tabs, switches, and anything explicitly marked clickable.
const TAP_SELECTOR =
  'button, a[href], [role="button"], [role="tab"], [role="menuitem"], ' +
  '[role="menuitemradio"], [role="switch"], [role="option"], summary, label, ' +
  'input[type="checkbox"], input[type="radio"], select, [data-haptic]';

/**
 * Install ONE global listener that fires a light haptic on press of any
 * interactive element. Call once at app start. pointerdown (not click) so the
 * buzz lands the instant the finger touches, like a native app. Skips disabled
 * controls and anything opted out with `data-haptic="off"`.
 */
export function installGlobalHaptics(): void {
  if (typeof document === "undefined") return;
  const w = window as unknown as { __hapticsInstalled?: boolean };
  if (w.__hapticsInstalled) return;
  w.__hapticsInstalled = true;
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!canVibrate()) return;
      const el = (e.target as Element | null)?.closest?.(TAP_SELECTOR) as
        | (HTMLElement & { disabled?: boolean })
        | null;
      if (!el || el.disabled || el.getAttribute("data-haptic") === "off") return;
      haptic("light");
    },
    { capture: true, passive: true },
  );
}
