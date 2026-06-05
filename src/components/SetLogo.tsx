import { useEffect, useRef, useState } from "react";

// Derive a set id from a card id: "sv8pt5-161" -> "sv8pt5",
// "tcgp-PB-11" -> "tcgp-PB", "me2pt5-284::holo" -> "me2pt5".
function deriveSetId(cardId: string): string {
  const base = cardId.split("::")[0];
  return base.split("-").slice(0, -1).join("-") || base;
}

interface SetLogoProps {
  /** Pass a set id directly... */
  setId?: string;
  /** ...or a card/tcg_api_id to derive it from. */
  cardId?: string;
  /** Explicit CDN logo (e.g. card.set.images.logo) used before the derived one. */
  fallbackUrl?: string;
  alt?: string;
  className?: string;
}

/**
 * Set logo with a bulletproof 3-tier fallback (same chain the Sets page uses):
 * local /data/logos/{id}.png -> Scrydex CDN -> render nothing. Never shows a
 * broken image. Static assets only — no DB calls, lazy-loaded.
 */
export default function SetLogo({ setId, cardId, fallbackUrl, alt = "", className }: SetLogoProps) {
  const id = setId || (cardId ? deriveSetId(cardId) : "");
  const local = id ? `/data/logos/${id}.png` : "";
  const cdn = fallbackUrl || (id ? `https://images.scrydex.com/pokemon/${id}-logo/logo` : "");

  const [src, setSrc] = useState<string | null>(local || cdn || null);
  const triedCdn = useRef(false);

  // Re-resolve when the set changes (rows get reused across re-sort/tab switch).
  useEffect(() => {
    triedCdn.current = false;
    setSrc(local || cdn || null);
  }, [local, cdn]);

  if (!src) return null;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={className}
      onError={() => {
        if (!triedCdn.current && cdn && src !== cdn) {
          triedCdn.current = true;
          setSrc(cdn);
        } else {
          setSrc(null);
        }
      }}
    />
  );
}
