// First-vote explainer trigger. Fires a one-time window event the very first
// time a user casts a sentiment vote, so a global dialog can explain what
// sentiment voting is. Lives in lib (not a component) so the single shared
// vote entry point — castVote — can call it and cover every vote surface
// (Market, CardDetail, SealedDetail, the widgets) without each wiring its own.

const SEEN_KEY = "collectiblez:sentiment-intro-seen";
export const SENTIMENT_INTRO_EVENT = "collectiblez:sentiment-intro";

let shownThisSession = false;

/** If the user has never seen the sentiment explainer, mark it seen and emit
 *  the event that opens the dialog. No-op on every subsequent vote. */
export function maybeShowSentimentIntro(): void {
  if (shownThisSession) return;
  try {
    if (localStorage.getItem(SEEN_KEY)) {
      shownThisSession = true;
      return;
    }
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* private mode / storage disabled — fall back to the in-session guard */
  }
  shownThisSession = true;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SENTIMENT_INTRO_EVENT));
  }
}
