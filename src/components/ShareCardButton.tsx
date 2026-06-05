import { useRef, useState } from "react";
import { toPng } from "html-to-image";
import { Share2, Download, Link as LinkIcon, Loader2, TrendingUp, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatPrice, type PokemonCard } from "@/lib/pokemon-api";

interface ShareCardButtonProps {
  card: PokemonCard;
  price: number | null;
  pct24h: number | null;
  /** Absolute URL to the card page (for the native share sheet + copy-link). */
  shareUrl: string;
  /** Render as a bare circular icon (no "Share" label) to pair with other
   *  icon actions. Used in the mobile card-header action cluster. */
  iconOnly?: boolean;
}

/**
 * Share affordance for a card page. Opens a dialog with a COLLECTR-style
 * generated graphic (card art + price + branding) snapshotted from a styled
 * DOM node via html-to-image — no backend / edge function. Offers native
 * share (image on mobile), download, and copy-link. The card image is on
 * Scrydex's CDN which sends `access-control-allow-origin: *`, so the canvas
 * is never tainted.
 */
export default function ShareCardButton({ card, price, pct24h, shareUrl, iconOnly }: ShareCardButtonProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  const fileName = `collectiblez-${card.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${card.number}.png`;

  async function buildPng(): Promise<string> {
    if (!cardRef.current) throw new Error("no node");
    // Two passes — the first warms the cross-origin image fetch/decode so the
    // second capture reliably includes the card art.
    await toPng(cardRef.current, { cacheBust: true, pixelRatio: 2 });
    return toPng(cardRef.current, { cacheBust: true, pixelRatio: 2 });
  }

  async function handleShare() {
    // Mobile (file share supported) → share the generated graphic, perfect for
    // posting to socials. Desktop → share/copy the LINK, which unfurls with the
    // card art via our per-card OG tags. We never silently produce an image on
    // desktop — that's what the explicit Download button is for.
    const canShareFiles =
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [new File([], "x.png", { type: "image/png" })] });

    if (canShareFiles) {
      setBusy(true);
      try {
        const dataUrl = await buildPng();
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], fileName, { type: "image/png" });
        await navigator.share({
          files: [file],
          title: card.name,
          text: `${card.name}${price != null ? ` — ${formatPrice(price)}` : ""} on Collectiblez`,
          url: shareUrl,
        });
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") toast.error("Couldn't generate image");
      } finally {
        setBusy(false);
      }
      return;
    }

    // No file share → share the link (or copy it as a fallback).
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({
          title: card.name,
          text: `${card.name}${price != null ? ` — ${formatPrice(price)}` : ""} on Collectiblez`,
          url: shareUrl,
        });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        toast.success("Link copied");
      }
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        await navigator.clipboard.writeText(shareUrl).then(
          () => toast.success("Link copied"),
          () => toast.error("Couldn't share"),
        );
      }
    }
  }

  async function handleDownload() {
    setBusy(true);
    try {
      const dataUrl = await buildPng();
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = fileName;
      a.click();
      toast.success("Image saved");
    } catch {
      toast.error("Couldn't generate image");
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy link");
    }
  }

  const up = (pct24h ?? 0) >= 0;

  return (
    <Dialog>
      <DialogTrigger asChild>
        {iconOnly ? (
          <Button
            variant="outline"
            size="icon"
            aria-label="Share"
            className="w-8 h-8 rounded-full border-border text-muted-foreground hover:text-foreground"
          >
            <Share2 className="w-4 h-4" />
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="gap-1.5">
            <Share2 className="w-4 h-4" />
            Share
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Share this card</DialogTitle>
        </DialogHeader>

        {/* ── Generated share graphic (what gets captured) ── */}
        <div className="flex justify-center">
          <div
            ref={cardRef}
            className="relative w-[300px] rounded-2xl overflow-hidden"
            style={{ background: "linear-gradient(160deg, #0f172a 0%, #0b1220 55%, #062925 100%)" }}
          >
            <div className="p-5 flex flex-col items-center gap-4">
              {/* Brand row — centered wordmark */}
              <div className="flex items-center justify-center gap-2">
                <span className="text-sm font-bold tracking-[0.25em] text-white uppercase">
                  Collectiblez
                </span>
              </div>

              {/* Card art */}
              <img
                src={card.images.large || card.images.small}
                alt={card.name}
                crossOrigin="anonymous"
                className="w-[200px] rounded-lg shadow-2xl"
              />

              {/* Name + set */}
              <div className="text-center w-full">
                <div className="text-white font-bold text-base leading-tight truncate">
                  {card.name}
                </div>
                <div className="text-slate-400 text-xs mt-0.5">
                  {card.set.name} · #{card.number}
                </div>
              </div>

              {/* Price */}
              {price != null && (
                <div className="flex items-baseline gap-2">
                  <span className="text-white font-extrabold text-3xl tabular-nums">
                    {formatPrice(price)}
                  </span>
                  {pct24h != null && (
                    <span className={`flex items-center gap-0.5 text-sm font-semibold ${up ? "text-emerald-400" : "text-red-400"}`}>
                      {up ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                      {up ? "+" : ""}{pct24h.toFixed(1)}%
                    </span>
                  )}
                </div>
              )}

              {/* Footer */}
              <div className="self-stretch border-t border-white/10 pt-2.5 text-center">
                <span className="text-slate-300 text-xs font-medium tracking-wide">
                  collectiblez.app
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Actions ── */}
        <div className="flex flex-col gap-2">
          <Button onClick={handleShare} disabled={busy} className="gap-1.5">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
            Share
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={handleDownload} disabled={busy} className="gap-1.5">
              <Download className="w-4 h-4" />
              Download image
            </Button>
            <Button variant="outline" onClick={handleCopyLink} className="gap-1.5">
              <LinkIcon className="w-4 h-4" />
              Copy link
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
