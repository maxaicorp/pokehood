import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Copy, Check, QrCode } from "lucide-react";
import { generateQRCode, downloadQRCode } from "@/lib/qrcode";
import { motion } from "framer-motion";
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs sm:max-w-sm overflow-hidden">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <QrCode className="w-5 h-5 text-primary" />
            {title || "Share via QR Code"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          {/* QR Code Display */}
          <motion.div
            className="relative p-3 rounded-2xl bg-white shadow-lg w-fit max-w-full"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
          >
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="QR Code"
                className="w-44 h-44 sm:w-52 sm:h-52 rounded-lg"
                id="qr-code-image"
              />
            ) : (
              <div className="w-44 h-44 sm:w-52 sm:h-52 rounded-lg bg-muted animate-pulse flex items-center justify-center">
                <QrCode className="w-10 h-10 text-muted-foreground/30" />
              </div>
            )}
          </motion.div>

          {/* URL display + copy on same row */}
          <div className="flex items-center gap-2 w-full min-w-0">
            <div className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-muted/50 border border-border/50">
              <p className="text-xs text-muted-foreground truncate font-mono">{url}</p>
            </div>
            <Button
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={handleCopy}
              id="copy-link-button"
            >
              {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>

          {/* Download button */}
          <Button
            variant="hero"
            className="w-full"
            onClick={handleDownload}
            id="download-qr-button"
          >
            <Download className="w-4 h-4 mr-2" />
            Download PNG
          </Button>

          {/* Help text */}
          <p className="text-xs text-muted-foreground text-center">
            Scan with any phone camera to open your profile.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
