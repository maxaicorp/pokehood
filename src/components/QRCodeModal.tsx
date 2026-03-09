import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Download, Copy, Check, QrCode, X, Share2 } from "lucide-react";
import { SiX, SiFacebook, SiWhatsapp, SiReddit } from "react-icons/si";
import { generateQRCode, downloadQRCode } from "@/lib/qrcode";
import { toast } from "sonner";

interface QRCodeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  title?: string;
}

export default function QRCodeModal({ open, onOpenChange, url, title }: QRCodeModalProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open && url) {
      generateQRCode(url, 400).then(setQrDataUrl).catch(() => setQrDataUrl(null));
    }
  }, [open, url]);

  const handleDownload = async () => {
    try {
      const slug = url.split("/").pop() || "profile";
      await downloadQRCode(url, `pokevault-${slug}-qr.png`);
      toast.success("QR code downloaded!");
    } catch {
      toast.error("Failed to download QR code.");
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied to clipboard!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy link.");
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80"
        onClick={() => onOpenChange(false)}
      />

      {/* Modal */}
      <div className="relative z-10 w-[calc(100%-2rem)] max-w-sm mx-auto bg-background border border-border rounded-xl p-5 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display font-semibold text-foreground flex items-center gap-2">
            <Share2 className="w-5 h-5 text-primary" />
            {title || "Share Your Profile"}
          </h2>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-sm opacity-70 hover:opacity-100 transition-opacity text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* QR Code */}
        <div className="flex justify-center mb-6">
          <div className="p-3 bg-white rounded-xl shadow-md border border-border/50">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="QR Code"
                className="w-44 h-44"
                id="qr-code-image"
              />
            ) : (
              <div className="w-44 h-44 bg-muted animate-pulse rounded-lg flex items-center justify-center">
                <QrCode className="w-8 h-8 text-muted-foreground/30" />
              </div>
            )}
          </div>
        </div>

        {/* Social Share Buttons */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          <a
            href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent("Check out my collection on PokeVault!")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-1.5 p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <div className="w-10 h-10 rounded-full bg-black flex items-center justify-center text-white">
              <SiX className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-medium text-muted-foreground">X</span>
          </a>
          <a
            href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-1.5 p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <div className="w-10 h-10 rounded-full bg-[#1877F2] flex items-center justify-center text-white">
              <SiFacebook className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-medium text-muted-foreground">Facebook</span>
          </a>
          <a
            href={`https://api.whatsapp.com/send?text=${encodeURIComponent("Check out my collection on PokeVault! " + url)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-1.5 p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <div className="w-10 h-10 rounded-full bg-[#25D366] flex items-center justify-center text-white">
              <SiWhatsapp className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-medium text-muted-foreground">WhatsApp</span>
          </a>
          <a
            href={`https://reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent("Check out my collection on PokeVault!")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-1.5 p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <div className="w-10 h-10 rounded-full bg-[#FF4500] flex items-center justify-center text-white">
              <SiReddit className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-medium text-muted-foreground">Reddit</span>
          </a>
        </div>

        {/* URL + Copy */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 min-w-0 px-3 py-2.5 rounded-lg bg-muted border border-border/50">
            <p className="text-xs text-muted-foreground truncate font-mono">{url}</p>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="shrink-0 h-[38px] w-[38px]"
            onClick={handleCopy}
            id="copy-link-button"
          >
            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
          </Button>
        </div>

        {/* Download */}
        <Button
          variant="secondary"
          className="w-full text-sm h-10"
          onClick={handleDownload}
          id="download-qr-button"
        >
          <Download className="w-4 h-4 mr-2" />
          Download QR
        </Button>
      </div>
    </div>
  );
}
