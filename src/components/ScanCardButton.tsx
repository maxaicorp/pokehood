// ScanCardButton — photograph a card (or graded slab) and identify it via the
// vision-identify edge function (Scrydex Vision, 5 credits/scan).
//
// ADMIN-ONLY while in testing: the button only renders for admins, and the
// edge function enforces the same gate server-side. When opening to everyone,
// flip ADMIN_ONLY in supabase/functions/vision-identify/index.ts and drop the
// isAdmin check below — the per-user free-scan limit takes over from there.
//
// Flow: pick/capture image → client-side downscale to ~1500px JPEG (faster
// upload, Scrydex recommends 200–500KB) → POST multipart → match sheet →
// one tap adds to collection. Graded slabs pre-fill condition (e.g. "PSA 10").

import { useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { addToCollection } from "@/lib/collection-store";
import { type PokemonCard } from "@/lib/pokemon-api";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, ScanLine, Plus, Check } from "lucide-react";
import { toast } from "sonner";

interface VisionMatch {
  score: number;
  variant?: string;
  card: {
    id: string;
    name: string;
    supertype?: string;
    number?: string;
    rarity?: string;
    images?: { type?: string; small?: string; medium?: string; large?: string }[];
    expansion?: { id?: string; name?: string };
  };
}

interface VisionResult {
  analysis?: {
    type?: string; // "raw" | "graded"
    game?: string;
    graded_details?: {
      company?: string;
      grade_number?: string;
      grade_label?: string;
      cert?: string;
    };
  };
  matches?: VisionMatch[];
}

/** Downscale + JPEG-compress a photo before upload (max 1500px long side). */
async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const maxSide = 1500;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("compress failed"))),
      "image/jpeg",
      0.85,
    ),
  );
}

/** Map a Vision match's card payload onto the app-wide PokemonCard shape. */
function toPokemonCard(m: VisionMatch): PokemonCard {
  const front = m.card.images?.find((i) => i.type === "front") ?? m.card.images?.[0];
  const id = m.card.id;
  return {
    id,
    name: m.card.name,
    supertype: m.card.supertype ?? "Pokémon",
    set: {
      id: m.card.expansion?.id ?? id.slice(0, id.lastIndexOf("-")),
      name: m.card.expansion?.name ?? "Unknown Set",
      series: "",
      printedTotal: 0,
      total: 0,
      releaseDate: "",
      images: { symbol: "", logo: "" },
    },
    number: m.card.number ?? id.slice(id.lastIndexOf("-") + 1),
    rarity: m.card.rarity,
    images: {
      small: front?.small ?? `https://images.scrydex.com/pokemon/${id}/small`,
      large: front?.large ?? `https://images.scrydex.com/pokemon/${id}/large`,
    },
  };
}

export default function ScanCardButton({ onAdded }: { onAdded?: () => void }) {
  const { user, isAdmin } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<VisionResult | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [addingId, setAddingId] = useState<string | null>(null);

  // Testing phase: admins only (server enforces this too).
  if (!user || !isAdmin) return null;

  const handleFile = async (file: File) => {
    setOpen(true);
    setScanning(true);
    setResult(null);
    setAddedIds(new Set());
    try {
      const blob = await compressImage(file);
      const form = new FormData();
      form.append("image", blob, "scan.jpg");

      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Not signed in");

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vision-identify`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form },
      );
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload?.message || payload?.error || `Scan failed (${res.status})`);
      }
      setResult(payload?.data ?? null);
    } catch (e) {
      toast.error((e as Error).message || "Scan failed");
      setOpen(false);
    } finally {
      setScanning(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const graded = result?.analysis?.graded_details;
  const condition = graded?.company && graded?.grade_number
    ? `${graded.company} ${graded.grade_number}`
    : "NM";

  const handleAdd = async (m: VisionMatch) => {
    if (!user) return;
    setAddingId(m.card.id);
    try {
      const added = await addToCollection(toPokemonCard(m), user.id, condition);
      if (added) {
        toast.success(`${m.card.name} added to collection${condition !== "NM" ? ` (${condition})` : ""}`);
        setAddedIds((prev) => new Set(prev).add(m.card.id));
        onAdded?.();
      } else {
        toast.error("Failed to add card.");
      }
    } finally {
      setAddingId(null);
    }
  };

  const matches = (result?.matches ?? []).slice(0, 3);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
        <ScanLine className="w-4 h-4 mr-1" /> Scan
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Scan Card</DialogTitle>
          </DialogHeader>

          {scanning && (
            <div className="flex flex-col items-center gap-3 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              Identifying card…
            </div>
          )}

          {!scanning && result && (
            <div className="space-y-4">
              {graded && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
                  <Badge variant="secondary">{graded.company} {graded.grade_number}</Badge>
                  <span className="text-muted-foreground truncate">
                    {graded.grade_label}{graded.cert ? ` · Cert #${graded.cert}` : ""}
                  </span>
                </div>
              )}

              {matches.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No match found. Try a clearer, well-lit photo with the card filling the frame.
                </p>
              )}

              {matches.map((m) => {
                const added = addedIds.has(m.card.id);
                return (
                  <div key={m.card.id} className="flex items-center gap-3 rounded-lg border border-border p-2">
                    <img
                      src={m.card.images?.find((i) => i.type === "front")?.small ?? `https://images.scrydex.com/pokemon/${m.card.id}/small`}
                      alt={m.card.name}
                      className="h-20 w-auto rounded"
                      loading="lazy"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{m.card.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.card.expansion?.name ?? "Unknown set"}{m.card.number ? ` · #${m.card.number}` : ""}
                      </p>
                      <p className="text-[11px] text-muted-foreground">confidence {m.score.toFixed(2)}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="shrink-0 border border-border bg-transparent hover:bg-muted/50"
                      disabled={added || addingId === m.card.id}
                      onClick={() => handleAdd(m)}
                    >
                      {added
                        ? <Check className="h-4 w-4" />
                        : addingId === m.card.id
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <><Plus className="mr-1 h-4 w-4" /> Add</>}
                    </Button>
                  </div>
                );
              })}

              <Button
                variant="ghost"
                size="sm"
                className="w-full border border-border bg-transparent hover:bg-muted/50"
                onClick={() => inputRef.current?.click()}
              >
                <ScanLine className="mr-1 h-4 w-4" /> Scan another
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
