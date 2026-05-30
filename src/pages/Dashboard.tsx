import { useState, useMemo, useRef, useCallback } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { STRIPE_CONFIG } from "@/lib/stripe-config";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCollection, getTotalValue, getCollectionBySet, addToCollection } from "@/lib/collection-store";
import { formatPrice } from "@/lib/pokemon-api";
import { parseCsv, resolveImport, CsvRow } from "@/lib/csv-import";
import CollectionList from "@/components/CollectionList";
import ProfilePageEditor from "@/components/ProfilePageEditor";
import AnalyticsDashboard from "@/components/AnalyticsDashboard";
import WishlistDashboard from "@/components/WishlistDashboard";
import AppHeader from "@/components/AppHeader";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Wallet, Layers, CreditCard, Search, Upload, Loader2,
  Plus, LayoutGrid, User, BarChart3, Crown, Heart
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { NumberTicker } from "@/components/ui/number-ticker";
import { MagicCard } from "@/components/ui/magic-card";
import { NeonGradientCard } from "@/components/ui/neon-gradient-card";
import SEO from "@/components/SEO";

type Tab = "collection" | "wishlists" | "mypage" | "analytics";

export default function Dashboard() {
  const { user, loading, isPro, limits } = useAuth();
  const queryClient = useQueryClient();
  // Honor ?tab= so external links (e.g. the account-menu "Wishlist"
  // shortcut) can deep-link straight to a Dashboard tab.
  const [searchParams] = useSearchParams();
  const initialTab = ((): Tab => {
    const t = searchParams.get("tab");
    return t === "wishlists" || t === "mypage" || t === "analytics" ? t : "collection";
  })();
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [searchQuery, setSearchQuery] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importParsed, setImportParsed] = useState<CsvRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: collection = [], isLoading: collectionLoading } = useQuery({
    queryKey: ["my-collection", user?.id],
    queryFn: () => getCollection(),
    enabled: !!user,
    staleTime: 30_000,
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["my-collection"] });
  }, [queryClient]);

  const [checkoutLoading, setCheckoutLoading] = useState(false);
  // The "Vault Full" banner button previously did
  // `document.getElementById("upgrade-to-pro")?.click()`, but no element with
  // that id exists anywhere — so it silently did nothing. Invoke the same
  // Stripe checkout the header menu uses.
  const handleUpgrade = useCallback(async () => {
    setCheckoutLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { priceId: STRIPE_CONFIG.pro.price_id },
      });
      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
    } catch (err: any) {
      toast.error(err.message || "Failed to start checkout");
    }
    setCheckoutLoading(false);
  }, []);

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

  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (!user) return <Navigate to="/auth" replace />;

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
    if (!user) return;
    setImporting(true);
    // Total reflects only the matchable rows (the loop iterates result.found),
    // so the progress bar can actually reach 100%. resolveImport runs first, so
    // show an indeterminate-ish 0/0 until it returns.
    setImportProgress({ done: 0, total: importParsed.length });
    try {
      const result = await resolveImport(importParsed);
      setImportProgress({ done: 0, total: result.found.length });
      let added = 0;
      let limitHit = false;
      for (const { row, card } of result.found) {
        if (!isPro && (totalCards + added) >= limits.maxCards) {
          limitHit = true;
          break;
        }
        await addToCollection(card, user.id, row.condition || "NM", row.quantity || 1);
        added++;
        setImportProgress({ done: added, total: result.found.length });
      }
      // One coherent result toast — not an error + success pair on a limit hit.
      if (limitHit) {
        toast.error(`Imported ${added} cards, then hit the free-tier limit (${limits.maxCards}). Upgrade to Pro for unlimited cards!`);
      } else {
        toast.success(`Imported ${added} cards!${result.notFound.length ? ` ${result.notFound.length} not found.` : ""}`);
      }
      setImportOpen(false);
      setImportParsed([]);
      refresh();
    } catch {
      toast.error("Import failed. Please try again.");
    }
    setImporting(false);
  };

  const tabs: { id: Tab; label: string; icon: React.ElementType; pro?: boolean }[] = [
    { id: "collection", label: "Collection", icon: LayoutGrid },
    { id: "wishlists", label: "Wishlists", icon: Heart },
    { id: "mypage", label: "My Page", icon: User },
    { id: "analytics", label: "Analytics", icon: BarChart3, pro: true },
  ];

  return (
    <div className="min-h-screen bg-background pb-20 sm:pb-0">
      <SEO
        title="My Collection Dashboard — Collectiblez"
        description="Track your Pokémon TCG portfolio value, manage your collection, view analytics, and curate wishlists."
        path="/dashboard"
        noindex
      />
      <AppHeader activePage="dashboard">
        {/* Tabs */}
        <div className="container px-4 sm:px-8">
          <div className="flex gap-0 -mb-px">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <tab.icon className="w-4 h-4" />
                <span className="text-xs sm:text-sm">{tab.label}</span>
                {tab.pro && !isPro && <Crown className="w-3 h-3 text-primary ml-1" />}
              </button>
            ))}
          </div>
        </div>
      </AppHeader>

      <div className="container py-6 sm:py-8 px-4 sm:px-8">
        {activeTab === "collection" && (
          <div>
            {/* Stats */}
            <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-6 sm:mb-8">
              {[
                { icon: Wallet, label: "Total Value", num: totalValue, isCurrency: true, glow: true },
                { icon: CreditCard, label: "Cards", num: totalCards },
                { icon: Layers, label: "Sets", num: setCount },
              ].map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="h-full"
                >
                  <MagicCard className={`h-full p-3 sm:p-5 bg-card border-border/50 ${stat.glow ? "glow-primary" : ""}`}>
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <stat.icon className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] sm:text-sm text-muted-foreground truncate">{stat.label}</p>
                        <p className="text-lg sm:text-2xl font-display font-bold text-foreground truncate flex items-center gap-[2px]">
                          {stat.isCurrency && <span>$</span>}
                          <NumberTicker value={stat.num} decimalPlaces={stat.isCurrency ? 2 : 0} />
                        </p>
                      </div>
                    </div>
                  </MagicCard>
                </motion.div>
              ))}
            </div>

            {atCardLimit && (
              <NeonGradientCard 
                className="mb-4"
                borderSize={2}
                borderRadius={12}
                neonColors={{ firstColor: "#FF0000", secondColor: "#FF9900" }}
              >
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-1">
                  <div className="flex items-center gap-3">
                    <Crown className="w-6 h-6 text-amber-500" />
                    <div>
                      <h4 className="font-bold text-foreground">Vault Full</h4>
                      <p className="text-sm text-muted-foreground">You've reached the free tier limit of {limits.maxCards} cards.</p>
                    </div>
                  </div>
                  <Button onClick={handleUpgrade} disabled={checkoutLoading} className="bg-amber-500 hover:bg-amber-600 text-white shrink-0">
                    {checkoutLoading && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                    Upgrade to Pro ✨
                  </Button>
                </div>
              </NeonGradientCard>
            )}

            {/* Actions bar */}
            <div className="flex items-center gap-2 mb-4">
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="w-4 h-4 mr-1" /> Import CSV
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to="/explore"><Plus className="w-4 h-4 mr-1" /> Add Cards</Link>
              </Button>
            </div>

            {/* Search */}
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

            {collectionLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <CollectionList cards={filteredCollection} onUpdate={refresh} />
            )}
          </div>
        )}

        {activeTab === "wishlists" && <WishlistDashboard />}

        {activeTab === "mypage" && <ProfilePageEditor />}

        {activeTab === "analytics" && (
          <ErrorBoundary label="AnalyticsDashboard" fallback="Analytics couldn't render. Try refreshing.">
            <AnalyticsDashboard collection={collection} />
          </ErrorBoundary>
        )}
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
                <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${importProgress.total ? (importProgress.done / importProgress.total) * 100 : 0}%` }} />
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
    </div>
  );
}
