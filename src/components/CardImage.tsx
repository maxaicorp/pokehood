import { useState, ImgHTMLAttributes } from "react";

// Inline SVG placeholder (a neutral card-shaped tile). Baked in as a data URI
// so there's no asset dependency and no second network request on failure.
const PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='100' height='140' viewBox='0 0 100 140'>` +
      `<rect width='100' height='140' rx='6' fill='hsl(240 5% 16%)'/>` +
      `<text x='50' y='74' font-family='sans-serif' font-size='9' fill='hsl(240 5% 48%)' text-anchor='middle'>No image</text>` +
      `</svg>`,
  );

type Props = ImgHTMLAttributes<HTMLImageElement> & { src?: string | null };

/**
 * Drop-in <img> replacement that falls back to a placeholder when the source
 * fails to load (or is empty). Without this, a changed Scrydex CDN URL or a
 * card missing art shows the browser's broken-image glyph across every grid.
 *
 * Tracks the failed URL (not a boolean) so that when `src` changes to a new
 * value the component retries the new image instead of staying on the
 * placeholder forever.
 */
export default function CardImage({ src, alt = "", ...rest }: Props) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showPlaceholder = !src || failedSrc === src;
  return (
    <img
      src={showPlaceholder ? PLACEHOLDER : src!}
      alt={alt}
      onError={() => setFailedSrc(src ?? null)}
      {...rest}
    />
  );
}
