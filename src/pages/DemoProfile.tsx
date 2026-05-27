import { Link } from "react-router-dom";
import { ArrowLeft, ExternalLink, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/pokemon-api";
import { getPlatformIcon } from "@/lib/platform-icons";
import { motion } from "framer-motion";
import { ReactNode } from "react";

const DEMO_LINKS = [
  { label: "eBay Store", url: "https://ebay.com" },
  { label: "TCGplayer", url: "https://tcgplayer.com" },
  { label: "Discord Server", url: "https://discord.gg" },
  { label: "Instagram", url: "https://instagram.com" },
];

const DEMO_CARDS = [
  { name: "Charizard ex", set: "Surging Sparks", price: 45.0, img: "https://images.pokemontcg.io/sv7/6.png", rarity: "Double Rare" },
  { name: "Pikachu ex", set: "Surging Sparks", price: 32.5, img: "https://images.pokemontcg.io/sv7/57.png", rarity: "Double Rare" },
  { name: "Mewtwo ex", set: "Prismatic Evolutions", price: 28.0, img: "https://images.pokemontcg.io/sv8/58.png", rarity: "Ultra Rare" },
  { name: "Umbreon VMAX", set: "Evolving Skies", price: 62.0, img: "https://images.pokemontcg.io/swsh7/95.png", rarity: "VMAX" },
  { name: "Lugia V", set: "Silver Tempest", price: 18.5, img: "https://images.pokemontcg.io/swsh12/138.png", rarity: "Ultra Rare" },
  { name: "Rayquaza VMAX", set: "Evolving Skies", price: 24.0, img: "https://images.pokemontcg.io/swsh7/111.png", rarity: "VMAX" },
  { name: "Gengar VMAX", set: "Fusion Strike", price: 35.0, img: "https://images.pokemontcg.io/swsh8/271.png", rarity: "VMAX" },
  { name: "Mew VMAX", set: "Fusion Strike", price: 22.0, img: "https://images.pokemontcg.io/swsh8/114.png", rarity: "VMAX" },
];

const totalValue = DEMO_CARDS.reduce((s, c) => s + c.price, 0);

export default function DemoProfile() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl py-8 px-4 sm:px-8">
        <Button variant="ghost" size="sm" asChild className="mb-6">
          <Link to="/"><ArrowLeft className="w-4 h-4 mr-1" /> Back to Home</Link>
        </Button>

        {/* Profile Header */}
        <motion.div
          className="text-center mb-8"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="w-20 h-20 rounded-full bg-primary/20 border-4 border-primary mx-auto mb-3 flex items-center justify-center">
            <span className="text-2xl font-display font-bold text-primary">D</span>
          </div>
          <h1 className="font-display font-bold text-2xl text-foreground">DemoTrainer</h1>
          <p className="text-muted-foreground text-sm mt-1">Pokémon TCG collector & trader 🔥 | Chasing every chase card</p>
        </motion.div>

        {/* Value Badge */}
        <motion.div
          className="flex justify-center mb-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-card border border-border/50">
            <Wallet className="w-4 h-4 text-primary" />
            <span className="text-sm text-muted-foreground">Collection Value</span>
            <span className="text-lg font-display font-bold text-foreground">{formatPrice(totalValue)}</span>
          </div>
        </motion.div>

        {/* Links */}
        <motion.div
          className="space-y-2 mb-10"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
        >
          {DEMO_LINKS.map((link) => (
              <div
                key={link.label}
                className="flex items-center justify-between p-3 sm:p-4 rounded-xl bg-card border border-border/50 hover:border-primary/30 transition-colors cursor-default"
              >
                <div className="flex items-center gap-3">
                  <span className="w-5 h-5 flex items-center justify-center text-muted-foreground">{getPlatformIcon(link.url, "w-5 h-5")}</span>
                  <span className="text-sm font-semibold text-foreground">{link.label}</span>
                </div>
                <ExternalLink className="w-4 h-4 text-muted-foreground" />
              </div>
          ))}
        </motion.div>

        {/* Collection */}
        <div>
          <h2 className="font-display font-bold text-lg text-foreground mb-4">Collection ({DEMO_CARDS.length} cards)</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
            {DEMO_CARDS.map((card, i) => (
              <motion.div
                key={card.name}
                className="rounded-xl bg-card border border-border/50 overflow-hidden"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.03 }}
              >
                <div className="bg-background/50 p-1.5">
                  <img src={card.img} alt={card.name} className="w-full" loading="lazy" />
                </div>
                <div className="p-2 sm:p-3">
                  <p className="text-xs font-semibold text-foreground truncate">{card.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{card.set}</p>
                  <p className="text-xs font-bold text-primary mt-1">{formatPrice(card.price)}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <motion.div
          className="text-center mt-12 p-8 rounded-2xl bg-card border border-border/50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          <h3 className="font-display font-bold text-lg text-foreground mb-2">Want your own profile?</h3>
          <p className="text-sm text-muted-foreground mb-4">Create a free account and start building your vault.</p>
          <Button variant="hero" size="lg" asChild>
            <Link to="/auth">Get Started Free</Link>
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
