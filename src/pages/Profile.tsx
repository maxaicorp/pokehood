import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getCollection, getTotalValue } from "@/lib/collection-store";
import { formatPrice } from "@/lib/pokemon-api";
import QRCodeModal from "@/components/QRCodeModal";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink, Wallet, QrCode } from "lucide-react";
import { motion } from "framer-motion";

const DEMO_LINKS = [
  { label: "eBay Store", url: "#", icon: "🛒" },
  { label: "TCGplayer", url: "#", icon: "🃏" },
  { label: "Discord Server", url: "#", icon: "💬" },
  { label: "Instagram", url: "#", icon: "📸" },
];

export default function Profile() {
  const { slug } = useParams();
  const collection = getCollection();
  const totalValue = getTotalValue(collection);
  const [qrOpen, setQrOpen] = useState(false);

  const profileUrl = `${window.location.origin}/u/${slug || "demo"}`;

  return (
    <div className="min-h-screen bg-background">
      {/* Ambient glow */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[400px] sm:w-[600px] h-[300px] sm:h-[400px] bg-primary/8 rounded-full blur-[150px] pointer-events-none" />

      <div className="relative z-10 container max-w-2xl py-6 sm:py-8 px-4 sm:px-8">
        <Button variant="ghost" size="sm" className="mb-4 sm:mb-6" asChild>
          <Link to="/dashboard"><ArrowLeft className="w-4 h-4 mr-1" />Back</Link>
        </Button>

        {/* Profile header */}
        <motion.div className="text-center mb-6 sm:mb-8" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-primary/20 border-2 border-primary mx-auto mb-3 sm:mb-4 flex items-center justify-center">
            <span className="text-2xl sm:text-3xl font-display font-bold text-primary">
              {(slug || "D")[0].toUpperCase()}
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-display font-bold text-foreground">{slug || "demo"}</h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base px-4">
            Pokémon TCG collector & seller. Always looking for vintage holos! 🔥
          </p>
          <Button variant="outline" size="sm" className="mt-3 sm:mt-4 gap-2" onClick={() => setQrOpen(true)} id="profile-qr-button">
            <QrCode className="w-4 h-4" /> Share via QR
          </Button>
        </motion.div>

        {/* Value badge */}
        <motion.div className="flex justify-center mb-6 sm:mb-8" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }}>
          <div className="inline-flex items-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 rounded-full bg-card border border-border/50 glow-primary">
            <Wallet className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
            <span className="text-xs sm:text-sm text-muted-foreground">Collection Value</span>
            <span className="text-lg sm:text-xl font-display font-bold text-foreground">{formatPrice(totalValue)}</span>
          </div>
        </motion.div>

        {/* Links */}
        <motion.div className="space-y-2.5 sm:space-y-3 mb-8 sm:mb-10" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
          {DEMO_LINKS.map((link, i) => (
            <motion.a
              key={link.label}
              href={link.url}
              className="flex items-center justify-between p-3.5 sm:p-4 rounded-xl bg-card border border-border/50 hover:border-primary/30 transition-colors group card-shine"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.08 }}
            >
              <div className="flex items-center gap-3">
                <span className="text-lg sm:text-xl">{link.icon}</span>
                <span className="font-semibold text-foreground text-sm sm:text-base">{link.label}</span>
              </div>
              <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </motion.a>
          ))}
        </motion.div>

        {/* Card gallery */}
        <div>
          <h2 className="font-display font-bold text-base sm:text-lg text-foreground mb-3 sm:mb-4">
            Collection ({collection.length} cards)
          </h2>
          {collection.length > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 sm:gap-3">
              {collection.slice(0, 20).map((card, i) => (
                <motion.div
                  key={card.id}
                  className="rounded-xl overflow-hidden border border-border/50"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.04 }}
                  whileHover={{ scale: 1.05, zIndex: 10 }}
                >
                  <img src={card.imageSmall} alt={card.name} className="w-full" loading="lazy" />
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 rounded-xl bg-card border border-border/50">
              <p className="text-muted-foreground">No cards yet. Add some from the dashboard!</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-10 sm:mt-12 text-center">
          <p className="text-xs text-muted-foreground">
            Powered by <span className="font-display font-semibold text-foreground">PokeVault</span>
          </p>
        </div>
      </div>

      <QRCodeModal open={qrOpen} onOpenChange={setQrOpen} url={profileUrl} />
    </div>
  );
}
