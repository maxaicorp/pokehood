import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/** Resets scroll to the top on every route change. React Router does NOT do
 *  this by default — a client-side navigation keeps the previous page's scroll
 *  offset, so opening a new page (card, set, etc.) lands you mid-page at a
 *  "random" spot. Keyed on pathname only, so Market's ?tab= switches don't
 *  yank you to the top. */
export default function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}
