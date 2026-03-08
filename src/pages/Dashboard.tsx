import { useState, useCallback, useMemo, useRef } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { getCollection, getTotalValue, getCollectionBySet, CollectionCard, addToCollection } from "@/lib/collection-store";
import { formatPrice } from "@/lib/pokemon-api";
import { parseCsv, resolveImport, CsvRow } from "@/lib/csv-import";
import { STRIPE_CONFIG } from "@/lib/stripe-config";
import { supabase } from "@/integrations/supabase/client";
import CollectionList from "@/components/CollectionList";
import ThemeToggle from "@/components/ThemeToggle";
import QRCodeModal from "@/components/QRCodeModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, Wallet, Layers, CreditCard, Share2, Search, Upload, Loader2, QrCode, Plus, Crown, LogOut } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

export default function Dashboard() {
  const { user, loading, isPro, limits, signOut } = useAuth();
  const [collection, setCollection] = useState<CollectionCard[]>(getCollection());
  const [searchQuery, setSearchQuery] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importParsed, setImportParsed] = useState<CsvRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });
  const [qrOpen, setQrOpen] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const profileUrl = `${window.location.origin}/u/demo`;
  const refresh = useCallback(() => setCollection(getCollection()), []);

  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (!user) return <Navigate to="/auth" replace />;

  const totalValue = getTotalValue(collection);
  const bySet = getCollectionBySet(collection);
  const setCount = Object.keys(bySet).length;
  const totalCards = collection.reduce((s, c) => s + c.quantity, 0);
  const atCardLimit = !isPro && totalCards >= limits.maxCards;

  const filteredCollection = useMemo(() => {
    if (!searchQuery.trim()) return collection;
    const q = searchQuery.toLowerCase();
    return collection.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.setName.toLowerCase().includes(q) ||
        c.rarity.toLowerCase().includes(q)
    );
  }, [collection, searchQuery]);

  // CSV Import handlers
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCsv(text);
      if (rows.length === 0) {
        toast.error("Could not parse CSV. Ensure it has a 'Name' column.");
        return;
      }
      setImportParsed(rows);
      setImportOpen(true);
    };
    reader.readAsText(file);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleImport = async () => {
    setImporting(true);
    setImportProgress({ done: 0, total: importParsed.length });
    try {
      const result = await resolveImport(importParsed);
      let added = 0;
      for (const { row, card } of result.found) {
        if (!isPro && (totalCards + added) >= limits.maxCards) {
          toast.error(`Free tier limit reached (${limits.maxCards} cards). Upgrade to Pro for unlimited cards!`);
          break;
        }
        addToCollection(card, row.condition || "NM", row.quantity || 1);
        added++;
        setImportProgress({ done: added, total: importParsed.length });
      }
      toast.success(`Imported ${added} cards! ${result.notFound.length} not found.`);
      setImportOpen(false);
      setImportParsed([]);
      refresh();
    } catch {
      toast.error("Import failed. Please try again.");
    }
    setImporting(false);
  };

  const handleUpgrade = async () => {
    setCheckoutLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { priceId: STRIPE_CONFIG.pro.price_id },
      });
      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to start checkout");
    }
    setCheckoutLoading(false);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="container flex items-center justify-between h-14 sm:h-16 px-4 sm:px-8">
          <div className="flex items-center gap-2 sm:gap-4">
            <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
              <Link to="/"><ArrowLeft className="w-4 h-4" /></Link>
            </Button>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-display font-bold text-xs sm:text-sm">PV</span>
              </div>
              <span className="font-display font-bold text-base sm:text-lg text-foreground hidden xs:inline">My Collection</span>
              {isPro && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold">
                  <Crown className="w-3 h-3" /> PRO
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
            <Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={() => fileRef.current?.click()}>
              <Upload className="w-4 h-4 mr-1" /> Import CSV
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8 sm:hidden" onClick={() => fileRef.current?.click()} title="Import CSV">
              <Upload className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" className="hidden sm:inline-flex" asChild>
              <Link to="/explore"><Plus className="w-4 h-4 mr-1" /> Add Cards</Link>
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8 sm:hidden" asChild>
              <Link to="/explore"><Plus className="w-4 h-4" /></Link>
            </Button>
            <ThemeToggle />
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setQrOpen(true)} title="Share QR Code">
              <QrCode className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={signOut} title="Sign Out">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="container py-6 sm:py-8 px-4 sm:px-8">
        {/* Upgrade Banner */}
        {!isPro && (
          <motion.div
            className="mb-6 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="flex items-center gap-3">
              <Crown className="w-5 h-5 text-amber-500 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Free Tier — {totalCards}/{limits.maxCards} cards used
                </p>
                <p className="text-xs text-muted-foreground">
                  Upgrade to Pro for unlimited cards, custom profile slugs, and unlimited links.
                </p>
              </div>
            </div>
            <Button size="sm" onClick={handleUpgrade} disabled={checkoutLoading} className="shrink-0 bg-amber-500 hover:bg-amber-600 text-white">
              {checkoutLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Crown className="w-4 h-4 mr-1" />}
              Upgrade — {STRIPE_CONFIG.pro.price}
            </Button>
          </motion.div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-6 sm:mb-8">
          {[
            { icon: Wallet, label: "Total Value", value: formatPrice(totalValue), glow: true },
            { icon: CreditCard, label: "Cards", value: String(totalCards) },
            { icon: Layers, label: "Sets", value: String(setCount) },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              className={`p-3 sm:p-5 rounded-xl bg-card border border-border/50 ${stat.glow ? 'glow-primary' : ''}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
            >
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <stat.icon className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] sm:text-sm text-muted-foreground truncate">{stat.label}</p>
                  <p className="text-lg sm:text-2xl font-display font-bold text-foreground truncate">{stat.value}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Card limit warning */}
        {atCardLimit && (
          <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-sm text-destructive">
            You've reached the free tier limit of {limits.maxCards} cards. <button onClick={handleUpgrade} className="font-semibold underline">Upgrade to Pro</button> for unlimited cards.
          </div>
        )}

        {/* Search Bar */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search your collection..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            {filteredCollection.length} of {collection.length} cards
            {searchQuery && ` matching "${searchQuery}"`}
          </p>
        </div>

        {/* Collection */}
        <CollectionList cards={filteredCollection} onUpdate={refresh} />
      </div>

      {/* Import Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg mx-4">
          <DialogHeader>
            <DialogTitle className="font-display">Import Collection</DialogTitle>
          </DialogHeader>
          {importing ? (
            <div className="py-8 text-center space-y-4">
              <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
              <p className="text-sm text-muted-foreground">
                Importing {importProgress.done} / {importProgress.total} cards...
              </p>
              <div className="w-full bg-secondary rounded-full h-2">
                <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${(importProgress.done / importProgress.total) * 100}%` }} />
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Found <span className="text-foreground font-semibold">{importParsed.length}</span> cards in your CSV.
              </p>
              <ScrollArea className="max-h-60 border border-border rounded-lg">
                <div className="p-3 space-y-1">
                  {importParsed.slice(0, 50).map((row, i) => (
                    <div key={i} className="flex items-center justify-between text-sm py-1">
                      <span className="text-foreground truncate flex-1">{row.name}</span>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        {row.setName && <span className="text-xs truncate max-w-[100px]">{row.setName}</span>}
                        <span className="text-xs">×{row.quantity || 1}</span>
                      </div>
                    </div>
                  ))}
                  {importParsed.length > 50 && (
                    <p className="text-xs text-muted-foreground text-center py-2">...and {importParsed.length - 50} more</p>
                  )}
                </div>
              </ScrollArea>
              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button variant="ghost" onClick={() => setImportOpen(false)}>Cancel</Button>
                <Button variant="hero" onClick={handleImport}>
                  <Upload className="w-4 h-4 mr-1" /> Import {importParsed.length} Cards
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <QRCodeModal open={qrOpen} onOpenChange={setQrOpen} url={profileUrl} title="Share Your Profile" />
    </div>
  );
}
