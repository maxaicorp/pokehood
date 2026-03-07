import { useState, useCallback, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { getCollection, getTotalValue, getCollectionBySet, CollectionCard, addToCollection } from "@/lib/collection-store";
import { formatPrice } from "@/lib/pokemon-api";
import { parseCsv, resolveImport, CsvRow } from "@/lib/csv-import";
import CollectionList from "@/components/CollectionList";
import ThemeToggle from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, Wallet, Layers, CreditCard, Share2, Search, Upload, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

export default function Dashboard() {
  const [collection, setCollection] = useState<CollectionCard[]>(getCollection());
  const [searchQuery, setSearchQuery] = useState("");

  // CSV Import state
  const [importOpen, setImportOpen] = useState(false);
  const [importParsed, setImportParsed] = useState<CsvRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    setCollection(getCollection());
  }, []);

  const totalValue = getTotalValue(collection);
  const bySet = getCollectionBySet(collection);
  const setCount = Object.keys(bySet).length;

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

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link to="/"><ArrowLeft className="w-4 h-4" /></Link>
            </Button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-display font-bold text-sm">PV</span>
              </div>
              <span className="font-display font-bold text-lg text-foreground">My Collection</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileUpload}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="w-4 h-4 mr-1" />
              Import CSV
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/explore">+ Add Cards</Link>
            </Button>
            <ThemeToggle />
            <Button variant="accent" size="sm" asChild>
              <Link to="/u/demo"><Share2 className="w-4 h-4 mr-1" />View Profile</Link>
            </Button>
          </div>
        </div>
      </header>

      <div className="container py-8">
        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {[
            { icon: Wallet, label: "Total Value", value: formatPrice(totalValue), glow: true },
            { icon: CreditCard, label: "Cards", value: String(collection.reduce((s, c) => s + c.quantity, 0)) },
            { icon: Layers, label: "Sets", value: String(setCount) },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              className={`p-5 rounded-xl bg-card border border-border/50 ${stat.glow ? 'glow-primary' : ''}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <stat.icon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className="text-2xl font-display font-bold text-foreground">{stat.value}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <div className="relative max-w-md">
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
        <DialogContent className="max-w-lg">
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
                <div
                  className="bg-primary h-2 rounded-full transition-all"
                  style={{ width: `${(importProgress.done / importProgress.total) * 100}%` }}
                />
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Found <span className="text-foreground font-semibold">{importParsed.length}</span> cards in your CSV.
                We'll search for each card and add matches to your collection.
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
                    <p className="text-xs text-muted-foreground text-center py-2">
                      ...and {importParsed.length - 50} more
                    </p>
                  )}
                </div>
              </ScrollArea>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setImportOpen(false)}>Cancel</Button>
                <Button variant="hero" onClick={handleImport}>
                  <Upload className="w-4 h-4 mr-1" />
                  Import {importParsed.length} Cards
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
