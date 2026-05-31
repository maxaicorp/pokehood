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
}

/**
 * Share affordance for a card page. Opens a dialog with a COLLECTR-style
 * generated graphic (card art + price + branding) snapshotted from a styled
 * DOM node via html-to-image — no backend / edge function. Offers native
 * share (image on mobile), download, and copy-link. The card image is on
 * Scrydex's CDN which sends `access-control-allow-origin: *`, so the canvas
 * is never tainted.
 */
export default function ShareCardButton({ card, price, pct24h, shareUrl }: ShareCardButtonProps) {
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

  async function handleShareImage() {
    setBusy(true);
    try {
      const dataUrl = await buildPng();
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], fileName, { type: "image/png" });
      const shareData = {
        files: [file],
        title: card.name,
        text: `${card.name}${price != null ? ` — ${formatPrice(price)}` : ""} on Collectiblez`,
        url: shareUrl,
      };
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share(shareData);
      } else {
        // No file share (most desktops) → download the image instead.
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = fileName;
        a.click();
        toast.success("Image saved");
      }
    } catch (err) {
      // AbortError = user dismissed the share sheet; not an error worth a toast.
      if ((err as Error)?.name !== "AbortError") toast.error("Couldn't generate image");
    } finally {
      setBusy(false);
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
        <Button variant="outline" size="sm" className="gap-1.5">
          <Share2 className="w-4 h-4" />
          Share
        </Button>
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
              {/* Brand row */}
              <div className="self-start flex items-center gap-2">
                <span className="text-[15px] font-bold tracking-tight text-white">
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
                <span className="text-emerald-400 text-xs font-semibold tracking-wide">
                  collectiblez.app
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Actions ── */}
        <div className="flex flex-col gap-2">
          <Button onClick={handleShareImage} disabled={busy} className="gap-1.5">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
            Share image
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={handleDownload} disabled={busy} className="gap-1.5">
              <Download className="w-4 h-4" />
              Download
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
