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
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <QrCode className="w-5 h-5 text-primary" />
            {title || "Share via QR Code"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-5 py-4">
          {/* QR Code Display */}
          <motion.div
            className="relative p-4 rounded-2xl bg-white shadow-lg"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
          >
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="QR Code"
                className="w-56 h-56 rounded-lg"
                id="qr-code-image"
              />
            ) : (
              <div className="w-56 h-56 rounded-lg bg-muted animate-pulse flex items-center justify-center">
                <QrCode className="w-10 h-10 text-muted-foreground/30" />
              </div>
            )}

            {/* Subtle corner accents */}
            <div className="absolute top-1 left-1 w-4 h-4 border-t-2 border-l-2 border-primary/30 rounded-tl-lg" />
            <div className="absolute top-1 right-1 w-4 h-4 border-t-2 border-r-2 border-primary/30 rounded-tr-lg" />
            <div className="absolute bottom-1 left-1 w-4 h-4 border-b-2 border-l-2 border-primary/30 rounded-bl-lg" />
            <div className="absolute bottom-1 right-1 w-4 h-4 border-b-2 border-r-2 border-primary/30 rounded-br-lg" />
          </motion.div>

          {/* URL display */}
          <div className="w-full px-3 py-2 rounded-lg bg-muted/50 border border-border/50 text-center">
            <p className="text-sm text-muted-foreground truncate font-mono">{url}</p>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 w-full">
            <Button
              variant="hero"
              className="flex-1"
              onClick={handleDownload}
              id="download-qr-button"
            >
              <Download className="w-4 h-4 mr-2" />
              Download PNG
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleCopy}
              id="copy-link-button"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 mr-2 text-green-500" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy Link
                </>
              )}
            </Button>
          </div>

          {/* Help text */}
          <p className="text-xs text-muted-foreground text-center">
            Scan this QR code with any phone camera to open your profile. 
            Download it to add to business cards, social posts, or eBay listings.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
