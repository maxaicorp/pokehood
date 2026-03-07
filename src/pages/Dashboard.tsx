import { useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { getCollection, getTotalValue, getCollectionBySet, CollectionCard } from "@/lib/collection-store";
import { formatPrice } from "@/lib/pokemon-api";
import CollectionList from "@/components/CollectionList";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Wallet, Layers, CreditCard, Share2, Search } from "lucide-react";
import { motion } from "framer-motion";

export default function Dashboard() {
  const [collection, setCollection] = useState<CollectionCard[]>(getCollection());
  const [searchQuery, setSearchQuery] = useState("");

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
            <Button variant="outline" size="sm" asChild>
              <Link to="/explore">+ Add Cards</Link>
            </Button>
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
    </div>
  );
}
