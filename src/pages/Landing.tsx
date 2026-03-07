import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { TrendingUp, Share2, Search, Zap, ExternalLink, Wallet } from "lucide-react";
import PhoneMockup from "@/components/PhoneMockup";

const EXAMPLE_CARDS = [
  "https://images.pokemontcg.io/base1/4.png",    // Charizard Base Set
  "https://images.pokemontcg.io/base1/2.png",    // Blastoise Base Set
  "https://images.pokemontcg.io/base1/15.png",   // Venusaur Base Set
  "https://images.pokemontcg.io/base1/58.png",   // Pikachu Base Set
  "https://images.pokemontcg.io/swsh12pt5gg/GG70.png", // Charizard VSTAR
];

const features = [
  {
    icon: Search,
    title: "Search & Add",
    desc: "Find any card from the Pokémon TCG database. Add to your collection in one click.",
  },
  {
    icon: TrendingUp,
    title: "Live Pricing",
    desc: "Real-time market prices from TCGplayer. Track your portfolio value as it changes.",
  },
  {
    icon: Share2,
    title: "Share Profile",
    desc: "Get a public profile page like Linktree — share your collection and selling links.",
  },
  {
    icon: Zap,
    title: "CSV Import",
    desc: "Import your TCGplayer collection export. Bulk add hundreds of cards instantly.",
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background overflow-hidden">
      {/* Nav */}
      <nav className="fixed top-0 w-full z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="container flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-display font-bold text-sm">PV</span>
            </div>
            <span className="font-display font-bold text-lg text-foreground">PokeVault</span>
          </Link>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/explore">Explore</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/dashboard">Dashboard</Link>
            </Button>
            <Button variant="hero" size="sm" asChild>
              <Link to="/explore">Get Started</Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-32 pb-20 md:pt-44 md:pb-32">
        {/* Ambient glow */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-accent/10 rounded-full blur-[120px] pointer-events-none" />

        <div className="container relative z-10">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7 }}
            >
              <p className="text-sm font-semibold tracking-widest uppercase text-primary mb-4">
                Pokémon TCG Portfolio
              </p>
              <h1 className="text-4xl md:text-6xl font-display font-bold leading-tight mb-6">
                Track, Value &{" "}
                <span className="text-gradient-primary">Share</span> Your
                Collection
              </h1>
              <p className="text-lg text-muted-foreground mb-8 max-w-lg">
                PokeVault is your all-in-one Pokémon TCG portfolio tracker.
                See live market prices, manage your cards, and share a
                beautiful public profile with buyers.
              </p>
              <div className="flex flex-wrap gap-4">
                <Button variant="hero" size="lg" asChild>
                  <Link to="/dashboard">Start Your Vault</Link>
                </Button>
                <Button variant="hero-outline" size="lg" asChild>
                  <Link to="/u/demo">See Example Profile</Link>
                </Button>
              </div>
            </motion.div>

            {/* Floating cards */}
            <motion.div
              className="relative h-[400px] hidden lg:block"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1, delay: 0.3 }}
            >
              {EXAMPLE_CARDS.map((src, i) => (
                <motion.img
                  key={i}
                  src={src}
                  alt="Pokémon card"
                  className="absolute w-40 rounded-xl shadow-2xl"
                  style={{
                    top: `${[10, 5, 40, 60, 20][i]}%`,
                    left: `${[5, 35, 55, 20, 70][i]}%`,
                    rotate: `${[-12, 5, -5, 8, -3][i]}deg`,
                    zIndex: [1, 3, 2, 1, 4][i],
                  }}
                  animate={{ y: [0, -8, 0] }}
                  transition={{
                    duration: 3,
                    delay: i * 0.4,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 border-t border-border/50">
        <div className="container">
          <motion.h2
            className="text-3xl md:text-4xl font-display font-bold text-center mb-4"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            Everything You Need
          </motion.h2>
          <p className="text-muted-foreground text-center mb-12 max-w-md mx-auto">
            From searching cards to sharing your profile — PokeVault handles the full loop.
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                className="p-6 rounded-xl bg-card border border-border/50 card-shine group"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
              >
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <f.icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-display font-semibold text-foreground mb-2">
                  {f.title}
                </h3>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Profile Preview */}
      <section className="py-20 border-t border-border/50 overflow-hidden">
        <div className="container">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <p className="text-sm font-semibold tracking-widest uppercase text-accent mb-4">
                Shareable Profiles
              </p>
              <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">
                Your <span className="text-gradient-accent">Linktree</span> for Pokémon Cards
              </h2>
              <p className="text-muted-foreground mb-6 max-w-lg">
                Every trainer gets a public profile page. Show off your collection, display your total portfolio value, and link to all your selling platforms — eBay, TCGplayer, Mercari, Discord, and more.
              </p>
              <Button variant="hero-outline" size="lg" asChild>
                <Link to="/u/demo">View Demo Profile</Link>
              </Button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7 }}
              className="flex justify-center"
            >
              <PhoneMockup>
                {/* Inline mini profile preview */}
                <div className="bg-background p-5 pt-10 min-h-[520px]">
                  <div className="text-center mb-5">
                    <div className="w-14 h-14 rounded-full bg-primary/20 border-2 border-primary mx-auto mb-3 flex items-center justify-center">
                      <span className="text-xl font-display font-bold text-primary">D</span>
                    </div>
                    <p className="font-display font-bold text-foreground text-sm">demo</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Pokémon TCG collector & seller 🔥</p>
                  </div>

                  <div className="flex justify-center mb-5">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-card border border-border/50 glow-primary">
                      <Wallet className="w-3.5 h-3.5 text-primary" />
                      <span className="text-[10px] text-muted-foreground">Value</span>
                      <span className="text-sm font-display font-bold text-foreground">$2,847</span>
                    </div>
                  </div>

                  <div className="space-y-2 mb-5">
                    {[
                      { label: "eBay Store", icon: "🛒" },
                      { label: "Mercari", icon: "📦" },
                    ].map((link) => (
                      <div
                        key={link.label}
                        className="flex items-center justify-between p-2.5 rounded-lg bg-card border border-border/50"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{link.icon}</span>
                          <span className="text-xs font-semibold text-foreground">{link.label}</span>
                        </div>
                        <ExternalLink className="w-3 h-3 text-muted-foreground" />
                      </div>
                    ))}
                  </div>

                  <p className="text-xs font-display font-semibold text-foreground mb-2">Collection</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      "https://images.pokemontcg.io/base1/4.png",      // Charizard
                      "https://images.pokemontcg.io/base1/2.png",      // Blastoise
                      "https://images.pokemontcg.io/base1/15.png",     // Venusaur
                      "https://images.pokemontcg.io/base1/58.png",     // Pikachu
                      "https://images.pokemontcg.io/sv3pt5/6.png",     // Charizard ex
                      "https://images.pokemontcg.io/swsh9/1.png",      // Venusaur VSTAR
                      "https://images.pokemontcg.io/det1/1.png",       // Pikachu Detective
                      "https://images.pokemontcg.io/swsh12pt5gg/GG70.png", // Charizard VSTAR
                      "https://images.pokemontcg.io/base1/25.png",     // Blastoise (another)
                    ].map((src, i) => (
                      <img key={i} src={src} alt="card" className="rounded-md w-full" loading="lazy" />
                    ))}
                  </div>
                </div>
              </PhoneMockup>
            </motion.div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20">
        <div className="container">
          <div className="relative rounded-2xl border border-border/50 bg-card p-12 text-center overflow-hidden">
            <div className="absolute inset-0 bg-primary/5" />
            <div className="relative z-10">
              <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">
                Ready to Build Your <span className="text-gradient-primary">Vault</span>?
              </h2>
              <p className="text-muted-foreground mb-8 max-w-md mx-auto">
                Join trainers who track their collection value and share their seller profiles.
              </p>
              <Button variant="hero" size="lg" asChild>
                <Link to="/dashboard">Get Started Free</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 py-8">
        <div className="container flex items-center justify-between text-sm text-muted-foreground">
          <span className="font-display font-semibold text-foreground">PokeVault</span>
          <span>Card data from pokemontcg.io</span>
        </div>
      </footer>
    </div>
  );
}
