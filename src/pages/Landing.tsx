import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { TrendingUp, Share2, Search, Zap, ExternalLink, Wallet, ArrowRight, CreditCard, Layers, QrCode, Menu, X } from "lucide-react";
import PhoneMockup from "@/components/PhoneMockup";
import CardSlider from "@/components/CardSlider";
import ThemeToggle from "@/components/ThemeToggle";
import pokeballHero from "@/assets/pokeball-hero.png";

// ─── Stats computed from data ───
interface SetInfo {
  id: string;
  name: string;
  cardCount?: { total: number; official: number };
}

export default function Landing() {
  const [stats, setStats] = useState({ sets: 200, cards: 23000, types: 11 });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    fetch("/data/sets-list.json")
      .then((r) => r.json())
      .then((sets: SetInfo[]) => {
        const totalCards = sets.reduce((s, set) => s + (set.cardCount?.total || 0), 0);
        setStats({ sets: sets.length, cards: totalCards, types: 11 });
      })
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen overflow-hidden transition-colors">
      {/* ═══ 1. Floating Pill Nav ═══ */}
      <nav className="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-auto">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-2xl backdrop-blur-xl border border-[#E5E5E5] dark:border-white/10 shadow-sm bg-[#F2F2F2]/90 dark:bg-white/10">
          <Link to="/" className="flex items-center gap-2 px-1.5 py-1 rounded-xl bg-[#141414] dark:bg-white h-8">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center overflow-hidden">
              <img src="/logo.png" alt="PokeVault" className="w-5 h-5 object-contain" />
            </div>
            <span className="font-display font-bold text-sm text-white dark:text-[#141414] pr-1.5 hidden sm:inline">PokeVault</span>
          </Link>
          <div className="hidden sm:flex items-center gap-0">
            <Link to="/dashboard" className="px-4 py-1.5 text-sm font-medium text-[#141414] dark:text-white/80 hover:text-[#666] dark:hover:text-white transition-colors">Dashboard</Link>
            <Link to="/explore" className="px-4 py-1.5 text-sm font-medium text-[#141414] dark:text-white/80 hover:text-[#666] dark:hover:text-white transition-colors">Explore</Link>
          </div>
          <Button size="sm" className="rounded-xl bg-[#141414] dark:bg-white text-white dark:text-[#141414] hover:bg-[#333] dark:hover:bg-white/90 h-8 px-5 text-sm font-semibold ml-1 hidden sm:inline-flex" asChild>
            <Link to="/auth">Get Started</Link>
          </Button>
          <ThemeToggle />
          {/* Mobile hamburger */}
          <button
            className="sm:hidden flex flex-col justify-center items-center w-8 h-8 gap-[5px] ml-0.5"
            onClick={() => setMobileMenuOpen((o) => !o)}
            aria-label="Toggle menu"
          >
            <span className={`block w-4 h-[1.5px] bg-[#141414] dark:bg-white transition-all duration-200 ${mobileMenuOpen ? "rotate-45 translate-y-[3.25px]" : ""}`} />
            <span className={`block w-4 h-[1.5px] bg-[#141414] dark:bg-white transition-all duration-200 ${mobileMenuOpen ? "-rotate-45 -translate-y-[3.25px]" : ""}`} />
          </button>
        </div>

        {/* Mobile dropdown */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="sm:hidden mt-2 rounded-2xl backdrop-blur-xl border border-[#E5E5E5] dark:border-white/10 shadow-lg bg-[#F2F2F2]/95 dark:bg-white/10 p-3 flex flex-col gap-1"
            >
              <Link to="/dashboard" onClick={() => setMobileMenuOpen(false)} className="px-4 py-2.5 text-sm font-medium text-[#141414] dark:text-white/80 hover:bg-black/5 dark:hover:bg-white/10 rounded-xl transition-colors">Dashboard</Link>
              <Link to="/explore" onClick={() => setMobileMenuOpen(false)} className="px-4 py-2.5 text-sm font-medium text-[#141414] dark:text-white/80 hover:bg-black/5 dark:hover:bg-white/10 rounded-xl transition-colors">Explore</Link>
              <Link to="/auth" onClick={() => setMobileMenuOpen(false)} className="px-4 py-2.5 text-sm font-semibold text-center rounded-xl bg-[#141414] dark:bg-white text-white dark:text-[#141414]">Get Started</Link>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      {/* ═══ 2. Hero ═══ */}
      <section className="relative pt-32 pb-16 md:pt-44 md:pb-24 transition-colors">
        <div className="container relative z-10 max-w-4xl mx-auto text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <motion.div
              className="w-24 h-24 md:w-32 md:h-32 mx-auto mb-8"
              animate={{ y: [0, -12, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              style={{ filter: "drop-shadow(0 12px 24px rgba(220, 38, 38, 0.35)) drop-shadow(0 4px 8px rgba(220, 38, 38, 0.2))" }}
            >
              <img src={pokeballHero} alt="Pokéball" className="w-full h-full object-contain" />
            </motion.div>
            <h1 className="font-display leading-none tracking-tight mb-6 text-foreground" style={{ fontWeight: 520, fontSize: "clamp(48px, 6vw, 80px)", lineHeight: "1" }}>
              Track, Value & Share Your Collection.
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-xl mx-auto leading-relaxed">
              The all-in-one Pokémon TCG portfolio tracker. Live prices, shareable profiles, and instant CSV import — completely free.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button size="lg" className="rounded-full bg-[#141414] dark:bg-white text-white dark:text-[#141414] hover:bg-[#333] dark:hover:bg-white/90 px-7 h-12 text-base font-semibold" asChild>
                <Link to="/auth">Start Your Vault <ArrowRight className="w-4 h-4 ml-2" /></Link>
              </Button>
              <Button variant="outline" size="lg" className="rounded-full px-7 h-12 text-base font-semibold border-[#E5E5E5] dark:border-white/15 text-[#141414] dark:text-white hover:bg-[#F4F4F4] dark:hover:bg-white/10" asChild>
                <Link to="/demo">See Demo Profile</Link>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ═══ 3. Horizontal Card Slider ═══ */}
      <section className="py-16 md:py-24 transition-colors">
        <div className="text-center mb-12">
          <motion.h2 className="font-display mb-3 text-foreground" style={{ fontWeight: 520, fontSize: "clamp(28px, 3.5vw, 44px)" }} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            From Base Set to Today
          </motion.h2>
          <p className="text-muted-foreground text-lg max-w-md mx-auto">Every card from every era, all in one place.</p>
        </div>
        <CardSlider />
      </section>

      {/* ═══ 4. Feature Cards ═══ */}
      <section className="py-20 md:py-28 transition-colors">
        <div className="container max-w-6xl">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Collection Dashboard */}
            <motion.div className="rounded-[2rem] p-8 md:p-10 bg-secondary" initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}>
              <div className="mb-6">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-background text-sm font-semibold text-foreground mb-4">
                  <CreditCard className="w-3.5 h-3.5" /> Collection Tracker
                </div>
                <h3 className="font-display mb-3 text-foreground" style={{ fontWeight: 520, fontSize: "28px", lineHeight: "1.2" }}>Your entire vault, one dashboard.</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">Search 23,000+ cards across 200 sets. Track quantities, conditions, and portfolio value. Import via CSV.</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {[{ icon: Search, label: "Filters" }, { icon: Zap, label: "CSV Import" }, { icon: TrendingUp, label: "Value Tracking" }, { icon: Layers, label: "Set Grouping" }].map((f) => (
                  <div key={f.label} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-background text-xs text-muted-foreground"><f.icon className="w-3 h-3" />{f.label}</div>
                ))}
              </div>
              <div className="mt-6 flex justify-center">
                <PhoneMockup>
                  <div className="bg-white p-4 pt-14 h-[520px] overflow-hidden">
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-5 h-5 rounded bg-[#141414] flex items-center justify-center"><span className="text-white font-display font-bold text-[7px]">PV</span></div>
                        <span className="font-display font-bold text-[10px] text-[#141414]">My Collection</span>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {[{ label: "Value", val: "$2,847" }, { label: "Cards", val: "156" }, { label: "Sets", val: "12" }].map((s) => (
                          <div key={s.label} className="p-1.5 rounded-md bg-[#F4F4F4]"><p className="text-[7px] text-[#999]">{s.label}</p><p className="text-[10px] font-display font-bold text-[#141414]">{s.val}</p></div>
                        ))}
                      </div>
                      {[
                        { name: "Charizard ex", set: "Surging Sparks", price: "$45.00", img: "https://assets.tcgdex.net/en/sv/sv08/006/low.webp" },
                        { name: "Pikachu ex", set: "Surging Sparks", price: "$32.50", img: "https://assets.tcgdex.net/en/sv/sv08/057/low.webp" },
                        { name: "Mewtwo ex", set: "Prismatic Evol.", price: "$28.00", img: "https://assets.tcgdex.net/en/sv/sv08/058/low.webp" },
                        { name: "Umbreon ex", set: "Prismatic Evol.", price: "$62.00", img: "https://assets.tcgdex.net/en/sv/sv08/061/low.webp" },
                        { name: "Lugia ex", set: "Surging Sparks", price: "$18.50", img: "https://assets.tcgdex.net/en/sv/sv08/117/low.webp" },
                        { name: "Rayquaza ex", set: "Surging Sparks", price: "$24.00", img: "https://assets.tcgdex.net/en/sv/sv08/123/low.webp" },
                        { name: "Gengar ex", set: "Surging Sparks", price: "$35.00", img: "https://assets.tcgdex.net/en/sv/sv08/045/low.webp" },
                      ].map((card) => (
                        <div key={card.name} className="flex items-center gap-2 p-1.5 rounded-md bg-[#F4F4F4]">
                          <img src={card.img} alt={card.name} className="w-7 h-10 rounded object-cover" loading="lazy" />
                          <div className="flex-1 min-w-0"><p className="text-[9px] font-semibold text-[#141414] truncate">{card.name}</p><p className="text-[7px] text-[#999]">{card.set}</p></div>
                          <p className="text-[9px] font-display font-bold text-[#141414]">{card.price}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </PhoneMockup>
              </div>
            </motion.div>

            {/* Shareable Profile */}
            <motion.div className="rounded-[2rem] p-8 md:p-10 bg-secondary" initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.1 }}>
              <div className="mb-6">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-background text-sm font-semibold text-foreground mb-4">
                  <Share2 className="w-3.5 h-3.5" /> Shareable Profiles
                </div>
                <h3 className="font-display mb-3 text-foreground" style={{ fontWeight: 520, fontSize: "28px", lineHeight: "1.2" }}>Your Linktree for Pokémon Cards.</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">Public profile to showcase your collection and link to all selling platforms. Share with a QR code.</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {[{ icon: Share2, label: "Public Profile" }, { icon: QrCode, label: "QR Code" }, { icon: ExternalLink, label: "Custom Links" }, { icon: Wallet, label: "Portfolio Value" }].map((f) => (
                  <div key={f.label} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-background text-xs text-muted-foreground"><f.icon className="w-3 h-3" />{f.label}</div>
                ))}
              </div>
              <div className="mt-6 flex justify-center">
                <PhoneMockup>
                  <div className="bg-white p-5 pt-10 h-[520px] overflow-hidden">
                    <div className="text-center mb-3">
                      <div className="w-10 h-10 rounded-full bg-[#F4F4F4] border-2 border-[#141414] mx-auto mb-1.5 flex items-center justify-center"><span className="text-sm font-display font-bold text-[#141414]">D</span></div>
                      <p className="font-display font-bold text-[#141414] text-[10px]">demo</p>
                      <p className="text-[8px] text-[#999] mt-0.5">Pokémon TCG collector 🔥</p>
                    </div>
                    <div className="flex justify-center mb-3">
                      <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#F4F4F4]">
                        <Wallet className="w-2.5 h-2.5 text-[#141414]" /><span className="text-[8px] text-[#999]">Value</span><span className="text-[9px] font-display font-bold text-[#141414]">$2,847</span>
                      </div>
                    </div>
                    <div className="space-y-1.5 mb-3">
                      {[{ label: "eBay Store", icon: "🛒" }, { label: "TCGplayer", icon: "🃏" }, { label: "Discord", icon: "💬" }].map((link) => (
                        <div key={link.label} className="flex items-center justify-between p-2 rounded-md bg-[#F4F4F4]">
                          <div className="flex items-center gap-1.5"><span className="text-xs">{link.icon}</span><span className="text-[9px] font-semibold text-[#141414]">{link.label}</span></div>
                          <ExternalLink className="w-2.5 h-2.5 text-[#999]" />
                        </div>
                      ))}
                    </div>
                    <p className="text-[8px] font-display font-semibold text-[#141414] mb-1.5">Collection</p>
                    <div className="grid grid-cols-3 gap-1">
                      {[
                        "https://assets.tcgdex.net/en/base/base1/004/low.webp",
                        "https://assets.tcgdex.net/en/base/base1/002/low.webp",
                        "https://assets.tcgdex.net/en/base/base1/015/low.webp",
                        "https://assets.tcgdex.net/en/base/base1/014/low.webp",
                        "https://assets.tcgdex.net/en/base/base1/016/low.webp",
                        "https://assets.tcgdex.net/en/base/base1/058/low.webp",
                      ].map((src, i) => (
                        <img key={i} src={src} alt="card" className="rounded w-full" loading="lazy" />
                      ))}
                    </div>
                  </div>
                </PhoneMockup>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ═══ 5. Growing Library Stats ═══ */}
      <section className="py-24 md:py-32 bg-secondary transition-colors">
        <div className="container text-center max-w-2xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}>
            <p className="text-sm font-semibold tracking-widest uppercase text-muted-foreground mb-6">A growing library of</p>
            <div className="space-y-1">
              {[`${stats.sets.toLocaleString()} sets`, `${stats.cards.toLocaleString()} cards`, `${stats.types} types`].map((text) => (
                <p key={text} className="font-display leading-none text-foreground" style={{ fontWeight: 520, fontSize: "clamp(40px, 5.5vw, 72px)" }}>{text}</p>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ═══ 6. FAQ ═══ */}
      <section className="py-20 md:py-28 bg-secondary transition-colors">
        <div className="container max-w-3xl">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }} className="text-center mb-12">
            <h2 className="font-display mb-3 text-foreground" style={{ fontWeight: 520, fontSize: "clamp(28px, 3.5vw, 44px)" }}>Frequently Asked Questions</h2>
            <p className="text-muted-foreground text-lg">Everything you need to know about PokeVault.</p>
          </motion.div>
          <div className="space-y-3">
            {[
              { q: "Is PokeVault free to use?", a: "Yes, completely free. Track your collection, get live valuations, share your profile, and import via CSV — all at no cost." },
              { q: "How do I add cards to my collection?", a: "Search our database of 23,000+ cards across 200+ sets using the Explore page. You can also bulk-import your collection via CSV file." },
              { q: "Where do the card prices come from?", a: "We pull market data from TCGdex and other sources so your portfolio value stays up to date automatically." },
              { q: "What are shareable profiles?", a: "Think of it as a Linktree for your Pokémon cards. You get a public page that shows your collection, total value, and links to your selling platforms like eBay or TCGplayer." },
              { q: "Can I share my profile with a QR code?", a: "Absolutely. Every profile gets an auto-generated QR code you can screenshot, print, or share at events and meetups." },
              { q: "What card conditions can I track?", a: "You can log conditions from Mint to Damaged for every card, plus track quantities and set manual or market-based prices." },
              { q: "Do I need an account?", a: "You can browse and explore cards without an account. To save your collection and create a shareable profile, just sign up — it's quick and free." },
            ].map((item, i) => (
              <motion.details key={i} className="group rounded-2xl bg-background border border-border overflow-hidden" initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.3, delay: i * 0.05 }}>
                <summary className="flex items-center justify-between cursor-pointer px-6 py-5 text-foreground font-semibold text-sm md:text-base list-none [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span className="ml-4 text-muted-foreground transition-transform group-open:rotate-45 text-xl leading-none">+</span>
                </summary>
                <div className="px-6 pb-5 text-muted-foreground text-sm leading-relaxed">{item.a}</div>
              </motion.details>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 7. CTA Box ═══ */}
      <section className="relative z-10 pt-20 pb-28 rounded-b-[3rem] transition-colors">
        <div className="container max-w-2xl">
          <motion.div className="relative rounded-[2rem] p-10 md:p-14 text-center overflow-hidden bg-secondary" initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <h2 className="font-display mb-4 text-foreground" style={{ fontWeight: 520, fontSize: "clamp(28px, 3.5vw, 40px)" }}>Ready to Build Your Vault?</h2>
            <p className="text-muted-foreground mb-8 max-w-md mx-auto">Join trainers who track their collection value and share their seller profiles.</p>
            <Button size="lg" className="rounded-full bg-foreground text-background hover:bg-foreground/80 px-8 h-12 text-base font-semibold" asChild>
              <Link to="/auth">Get Started Free <ArrowRight className="w-4 h-4 ml-2" /></Link>
            </Button>
          </motion.div>
        </div>
      </section>

      {/* ═══ 8. Footer ═══ */}
      <footer className="relative -mt-12 pt-24 pb-10 bg-[#141414] dark:bg-white transition-colors">
        <div className="container max-w-6xl">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-8 mb-16">
            <div className="md:col-span-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-lg bg-white dark:bg-[#141414] flex items-center justify-center"><span className="text-[#141414] dark:text-white font-display font-bold text-xs">PV</span></div>
                <span className="font-display font-bold text-lg text-white dark:text-[#141414]">PokeVault</span>
              </div>
              <p className="text-[#888] dark:text-[#666] text-sm leading-relaxed max-w-xs">Track your Pokémon TCG collection, monitor card values, and share your portfolio with the world.</p>
            </div>
            <div className="md:col-span-2">
              <p className="font-display font-semibold text-white dark:text-[#141414] text-sm mb-4">Product</p>
              <ul className="space-y-2.5">
                <li><Link to="/dashboard" className="text-[#888] dark:text-[#666] hover:text-white dark:hover:text-[#141414] text-sm transition-colors">Dashboard</Link></li>
                <li><Link to="/explore" className="text-[#888] dark:text-[#666] hover:text-white dark:hover:text-[#141414] text-sm transition-colors">Explore</Link></li>
                <li><Link to="/demo" className="text-[#888] dark:text-[#666] hover:text-white dark:hover:text-[#141414] text-sm transition-colors">Demo Profile</Link></li>
              </ul>
            </div>
            <div className="md:col-span-2">
              <p className="font-display font-semibold text-white dark:text-[#141414] text-sm mb-4">Features</p>
              <ul className="space-y-2.5">
                <li><span className="text-[#888] dark:text-[#666] text-sm">Collection Tracker</span></li>
                <li><span className="text-[#888] dark:text-[#666] text-sm">QR Code Sharing</span></li>
                <li><span className="text-[#888] dark:text-[#666] text-sm">CSV Import</span></li>
                <li><span className="text-[#888] dark:text-[#666] text-sm">Seller Profiles</span></li>
              </ul>
            </div>
            <div className="md:col-span-3">
              <p className="font-display font-semibold text-white dark:text-[#141414] text-sm mb-4">Legal</p>
              <ul className="space-y-2.5">
                <li><Link to="/privacy" className="text-[#888] dark:text-[#666] hover:text-white dark:hover:text-[#141414] text-sm transition-colors">Privacy Policy</Link></li>
                <li><Link to="/terms" className="text-[#888] dark:text-[#666] hover:text-white dark:hover:text-[#141414] text-sm transition-colors">Terms of Service</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-white/10 dark:border-[#141414]/10 pt-6 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-[#555] dark:text-[#999] text-xs">© PokeVault 2025–{new Date().getFullYear()}. All rights reserved.</p>
            <div className="flex items-center gap-6">
              <Link to="/privacy" className="text-[#555] dark:text-[#999] hover:text-white dark:hover:text-[#141414] text-xs transition-colors">Privacy policy</Link>
              <Link to="/terms" className="text-[#555] dark:text-[#999] hover:text-white dark:hover:text-[#141414] text-xs transition-colors">Terms</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
