import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toPng } from "html-to-image";
import {
  Archive,
  CalendarClock,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  RefreshCw,
  Send,
  Share2,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "./AdminLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatPrice } from "@/lib/pokemon-api";
import {
  generateMarketingContentSignals,
  listMarketingContentSignals,
  updateMarketingContentSignal,
  type ContentSignalStatus,
  type MarketingContentSignal,
} from "@/lib/content-signals";

const STATUS_FILTERS: Array<ContentSignalStatus | "all"> = ["draft", "approved", "scheduled", "posted", "archived", "all"];
const GRAPHIC_FORMATS = [
  { key: "square", label: "Square", ratio: "1:1", className: "h-[360px] w-[360px]" },
  { key: "horizontal", label: "Horizontal", ratio: "16:9", className: "h-[236px] w-[420px]" },
  { key: "vertical", label: "Vertical", ratio: "4:5", className: "h-[475px] w-[380px]" },
] as const;

type GraphicFormatKey = (typeof GRAPHIC_FORMATS)[number]["key"];

function formatPctValue(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function signalTypeLabel(type: string): string {
  if (type === "daily_mover") return "Daily mover";
  if (type === "weekly_mover") return "Weekly mover";
  if (type === "card_of_day") return "Card of day";
  if (type === "set_heat") return "Set heat";
  return type.replace(/_/g, " ");
}

function statusClass(status: ContentSignalStatus): string {
  if (status === "approved") return "bg-green-500/10 text-green-700 border-green-500/30";
  if (status === "scheduled") return "bg-blue-500/10 text-blue-700 border-blue-500/30";
  if (status === "posted") return "bg-primary/10 text-primary border-primary/30";
  if (status === "archived") return "bg-muted text-muted-foreground";
  return "bg-background text-foreground";
}

function imageFromSignal(signal: MarketingContentSignal): string {
  return String(
    signal.imagePayload.image ||
      signal.imagePayload.small ||
      signal.imagePayload.set_logo ||
      "",
  );
}

function fileNameFor(signal: MarketingContentSignal, format: GraphicFormatKey): string {
  const base = `${signal.signalType}-${signal.cardName || signal.setName || signal.id}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `collectiblez-${base || "signal"}-${format}.png`;
}

function absoluteTargetUrl(signal: MarketingContentSignal): string {
  if (typeof window === "undefined") return signal.targetPath || "/";
  try {
    return new URL(signal.targetPath || "/", window.location.origin).toString();
  } catch {
    return window.location.origin;
  }
}

async function dataUrlToFile(dataUrl: string, fileName: string): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], fileName, { type: blob.type || "image/png" });
}

function GraphicPreview({ signal, format }: { signal: MarketingContentSignal; format: GraphicFormatKey }) {
  const image = imageFromSignal(signal);
  const isSet = signal.signalType === "set_heat";
  const isSquare = format === "square";
  const isHorizontal = format === "horizontal";
  const pctUp = (signal.pctChange ?? 0) >= 0;
  const accent = pctUp ? "#22c55e" : "#ef4444";
  const formatInfo = GRAPHIC_FORMATS.find((item) => item.key === format) ?? GRAPHIC_FORMATS[0];
  const headline = signal.signalType === "card_of_day"
    ? "CARD OF THE DAY"
    : signal.signalType === "set_heat"
    ? "SET HEAT"
    : `${signal.window ?? ""} MOVER`;
  const subject = signal.cardName || signal.setName || "Market signal";
  const context = isSet ? "Collectiblez Set Index" : signal.setName || "Pokemon market";
  const valueLabel = signal.price != null
    ? formatPrice(signal.price)
    : signal.totalValue != null
    ? formatPrice(signal.totalValue)
    : "--";
  const moveLabel = formatPctValue(signal.pctChange);

  if (isHorizontal) {
    return (
      <div
        className={`relative overflow-hidden rounded-xl border border-white/15 bg-black text-white shadow-2xl ${formatInfo.className}`}
        style={{ fontFamily: "Inter, system-ui, sans-serif" }}
      >
        {image && !isSet && (
          <img
            src={image}
            alt=""
            crossOrigin="anonymous"
            className="absolute -right-6 top-0 h-[250px] w-[190px] rotate-6 object-contain opacity-18 blur-[1px]"
          />
        )}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_12%,rgba(255,255,255,0.2),transparent_22%),linear-gradient(135deg,#050505_0%,#101010_56%,#000_100%)]" />
        <div className="absolute inset-y-0 left-0 w-[5px]" style={{ backgroundColor: accent }} />
        <div className="absolute -bottom-14 -left-10 h-36 w-36 rounded-full opacity-25 blur-3xl" style={{ backgroundColor: accent }} />

        <div className="relative z-10 grid h-full grid-cols-[144px_1fr] gap-5 p-5">
          <div className="flex items-center justify-center rounded-2xl border border-white/12 bg-white/[0.06]">
            {image ? (
              <img
                src={image}
                alt=""
                crossOrigin="anonymous"
                className={isSet ? "max-h-[78px] max-w-[122px] object-contain drop-shadow-2xl" : "max-h-[190px] max-w-[118px] object-contain drop-shadow-2xl"}
              />
            ) : (
              <div className="text-xs font-bold text-white/45">No image</div>
            )}
          </div>

          <div className="flex min-w-0 flex-col justify-between">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.22em] text-white/48">Collectiblez</p>
                <p className="mt-1 text-[12px] font-black uppercase tracking-[0.12em] text-white">{headline}</p>
              </div>
              <div className="rounded-full border border-white/12 px-3 py-1 text-xs font-black tabular-nums" style={{ color: accent, backgroundColor: "rgba(255,255,255,0.06)" }}>
                {moveLabel}
              </div>
            </div>

            <div>
              <p className="line-clamp-2 text-[25px] font-black leading-[0.95] tracking-tight">{subject}</p>
              <p className="mt-2 truncate text-sm font-semibold text-white/52">{context}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.055] px-3 py-2">
                <p className="text-[9px] font-black uppercase tracking-[0.15em] text-white/42">{isSet ? "Index" : "NM market"}</p>
                <p className="mt-1 text-lg font-black tabular-nums">{valueLabel}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.055] px-3 py-2 text-right">
                <p className="text-[9px] font-black uppercase tracking-[0.15em] text-white/42">{signal.window || "Move"}</p>
                <p className="mt-1 text-lg font-black tabular-nums" style={{ color: accent }}>{moveLabel}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-white/15 bg-black text-white shadow-2xl ${formatInfo.className}`}
      style={{ fontFamily: "Inter, system-ui, sans-serif" }}
    >
      {image && !isSet && (
        <img
          src={image}
          alt=""
          crossOrigin="anonymous"
          className="absolute -right-10 top-8 h-[310px] w-[240px] rotate-6 object-contain opacity-25 blur-[2px]"
        />
      )}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_7%,rgba(255,255,255,0.22),transparent_24%),linear-gradient(150deg,#050505_0%,#101010_52%,#000_100%)]" />
      <div className="absolute inset-x-0 top-0 h-[5px]" style={{ backgroundColor: accent }} />
      <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full opacity-25 blur-3xl" style={{ backgroundColor: accent }} />

      <div className="relative z-10 flex h-full flex-col p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-white/50">
              Collectiblez
            </p>
            <p className="mt-1 text-[13px] font-black uppercase tracking-[0.12em] text-white">
              {headline}
            </p>
          </div>
          <div
            className="rounded-full border border-white/12 px-3 py-1 text-xs font-black tabular-nums"
            style={{ color: accent, backgroundColor: "rgba(255,255,255,0.06)" }}
          >
            {moveLabel}
          </div>
        </div>

        <div className={`relative flex flex-1 items-center justify-center ${isSquare ? "py-3" : "py-5"}`}>
          {image ? (
            <div className={isSet ? `${isSquare ? "min-h-[128px]" : "min-h-[190px]"} flex w-full items-center justify-center rounded-2xl border border-white/12 bg-white/[0.07] px-8` : "relative"}>
              <img
                src={image}
                alt=""
                crossOrigin="anonymous"
                className={isSet
                  ? `${isSquare ? "max-h-[92px]" : "max-h-[125px]"} max-w-[260px] object-contain drop-shadow-2xl`
                  : `${isSquare ? "max-h-[170px] max-w-[148px]" : "max-h-[280px] max-w-[205px]"} rounded-lg object-contain drop-shadow-2xl`}
              />
            </div>
          ) : (
            <div className="flex h-44 w-44 items-center justify-center rounded-xl border border-white/20 text-white/50">
              No image
            </div>
          )}
        </div>

        <div className={`rounded-2xl border border-white/12 bg-white/[0.06] ${isSquare ? "p-3" : "p-4"} backdrop-blur`}>
          <div>
            <p className={`${isSquare ? "text-[22px]" : "text-[26px]"} line-clamp-2 font-black leading-[0.98] tracking-tight`}>
              {subject}
            </p>
            <p className="mt-2 truncate text-sm font-semibold text-white/55">
              {context}
            </p>
          </div>

          <div className={`${isSquare ? "mt-3 py-2" : "mt-4 py-3"} grid grid-cols-2 gap-3 border-y border-white/12`}>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/42">
                {isSet ? "Index" : "NM market"}
              </p>
              <p className="mt-1 text-xl font-black tabular-nums">
                {valueLabel}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/42">
                {signal.window || "Move"}
              </p>
              <p className="mt-1 text-xl font-black tabular-nums" style={{ color: accent }}>
                {moveLabel}
              </p>
            </div>
          </div>

          <p className={`${isSquare ? "mt-2 text-xs" : "mt-3 text-sm"} line-clamp-2 font-semibold leading-snug text-white/80`}>
            {signal.summary}
          </p>
          <div className={`${isSquare ? "mt-3" : "mt-4"} flex items-center justify-between text-[11px] font-black uppercase tracking-[0.16em] text-white/42`}>
            <span>collectiblez.app</span>
            <span>{signal.signalDate}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminContentSignals() {
  const queryClient = useQueryClient();
  const previewRef = useRef<HTMLDivElement>(null);
  const [statusFilter, setStatusFilter] = useState<ContentSignalStatus | "all">("draft");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [previewFormat, setPreviewFormat] = useState<GraphicFormatKey>("square");

  const signalsQuery = useQuery({
    queryKey: ["marketing-content-signals", statusFilter],
    queryFn: () => listMarketingContentSignals(statusFilter),
  });

  const signals = signalsQuery.data ?? [];
  const selected = useMemo(
    () => signals.find((signal) => signal.id === selectedId) ?? signals[0] ?? null,
    [signals, selectedId],
  );

  useEffect(() => {
    if (!selected) {
      setCaption("");
      return;
    }
    setSelectedId(selected.id);
    setCaption(selected.caption);
  }, [selected?.id]);

  const generateMutation = useMutation({
    mutationFn: generateMarketingContentSignals,
    onSuccess: (count) => {
      toast.success(`Generated ${count} signal${count === 1 ? "" : "s"}`);
      queryClient.invalidateQueries({ queryKey: ["marketing-content-signals"] });
    },
    onError: (error: any) => toast.error(error?.message || "Could not generate signals"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateMarketingContentSignal>[1] }) =>
      updateMarketingContentSignal(id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["marketing-content-signals"] });
    },
    onError: (error: any) => toast.error(error?.message || "Could not update signal"),
  });

  async function saveCaption() {
    if (!selected) return;
    await updateMutation.mutateAsync({ id: selected.id, patch: { caption } });
    toast.success("Caption saved");
  }

  async function setStatus(status: ContentSignalStatus) {
    if (!selected) return;
    await updateMutation.mutateAsync({ id: selected.id, patch: { status } });
    toast.success(`Marked ${status}`);
  }

  async function copyCaption() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(caption);
      toast.success("Caption copied");
    } catch {
      toast.error("Could not copy caption");
    }
  }

  async function renderGraphicDataUrl(): Promise<string> {
    if (!selected || !previewRef.current) throw new Error("No graphic preview selected");
    return toPng(previewRef.current, { cacheBust: true, pixelRatio: 2, backgroundColor: "#050505" });
  }

  async function downloadGraphic() {
    if (!selected || !previewRef.current) return;
    try {
      const dataUrl = await renderGraphicDataUrl();
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = fileNameFor(selected, previewFormat);
      link.click();
      toast.success("Graphic exported");
    } catch {
      toast.error("Could not export graphic");
    }
  }

  async function shareGraphic() {
    if (!selected || !previewRef.current) return;
    const targetUrl = absoluteTargetUrl(selected);
    try {
      const dataUrl = await renderGraphicDataUrl();
      const file = await dataUrlToFile(dataUrl, fileNameFor(selected, previewFormat));
      const shareData = {
        title: selected.title,
        text: caption,
        url: targetUrl,
        files: [file],
      };

      if (navigator.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share(shareData);
        toast.success("Share sheet opened");
        return;
      }

      await navigator.clipboard.writeText(`${caption}\n\n${targetUrl}`);
      toast.success("Caption and link copied");
    } catch {
      toast.error("Could not open share sheet");
    }
  }

  async function openXComposer() {
    if (!selected) return;
    const targetUrl = absoluteTargetUrl(selected);
    try {
      await navigator.clipboard.writeText(caption);
      toast.success("Caption copied for X");
    } catch {
      toast.message("Opening X composer");
    }
    const params = new URLSearchParams({ text: caption, url: targetUrl });
    window.open(`https://twitter.com/intent/tweet?${params.toString()}`, "_blank", "noopener,noreferrer");
  }

  async function markPosted() {
    if (!selected) return;
    await updateMutation.mutateAsync({
      id: selected.id,
      patch: { status: "posted", postedAt: new Date().toISOString() },
    });
    toast.success("Marked posted");
  }

  return (
    <AdminLayout>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Content signals</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Draft marketing posts from cached market data.
          </p>
        </div>
        <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending} className="gap-2">
          <Wand2 className="w-4 h-4" />
          Generate signals
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {STATUS_FILTERS.map((status) => (
          <Button
            key={status}
            size="sm"
            variant={statusFilter === status ? "default" : "outline"}
            className="h-8 capitalize"
            onClick={() => setStatusFilter(status)}
          >
            {status}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5"
          onClick={() => signalsQuery.refetch()}
          disabled={signalsQuery.isFetching}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${signalsQuery.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="grid grid-cols-[1fr_86px_86px_92px] gap-3 px-4 py-2.5 border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground">
            <span>Signal</span>
            <span className="text-right">Move</span>
            <span className="text-right">Score</span>
            <span className="text-right">Status</span>
          </div>
          {signalsQuery.isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : signals.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No signals for this filter.
            </div>
          ) : (
            <div>
              {signals.map((signal) => (
                <button
                  key={signal.id}
                  type="button"
                  onClick={() => setSelectedId(signal.id)}
                  className={`grid w-full grid-cols-[1fr_86px_86px_92px] gap-3 px-4 py-3 text-left border-b border-border/50 last:border-0 hover:bg-muted/35 transition-colors ${
                    selected?.id === signal.id ? "bg-muted/50" : ""
                  }`}
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{signal.title}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{signalTypeLabel(signal.signalType)}</span>
                      {signal.window && <span>{signal.window}</span>}
                      <span className="truncate">{signal.setName}</span>
                    </span>
                  </span>
                  <span className={`text-sm font-semibold tabular-nums text-right ${signal.pctChange != null && signal.pctChange >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {formatPctValue(signal.pctChange)}
                  </span>
                  <span className="text-sm font-mono text-right text-muted-foreground">{signal.score.toFixed(1)}</span>
                  <span className="flex justify-end">
                    <Badge variant="outline" className={statusClass(signal.status)}>{signal.status}</Badge>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-border bg-card p-4">
            {selected ? (
              <>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{selected.title}</p>
                    <p className="text-xs text-muted-foreground">{signalTypeLabel(selected.signalType)} / {selected.signalDate}</p>
                  </div>
                  <Badge variant="outline" className={statusClass(selected.status)}>{selected.status}</Badge>
                </div>

                <div className="mb-3 flex flex-wrap gap-2">
                  {GRAPHIC_FORMATS.map((format) => (
                    <Button
                      key={format.key}
                      type="button"
                      size="sm"
                      variant={previewFormat === format.key ? "default" : "outline"}
                      className="h-8 gap-1.5"
                      onClick={() => setPreviewFormat(format.key)}
                    >
                      {format.label}
                      <span className="text-[10px] opacity-70">{format.ratio}</span>
                    </Button>
                  ))}
                </div>

                <div className="flex justify-center overflow-auto rounded-lg bg-muted/40 p-3">
                  <div ref={previewRef}>
                    <GraphicPreview signal={{ ...selected, caption }} format={previewFormat} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-4">
                  <Button onClick={downloadGraphic} className="gap-2">
                    <Download className="w-4 h-4" />
                    Export PNG
                  </Button>
                  <Button variant="outline" onClick={copyCaption} className="gap-2">
                    <Copy className="w-4 h-4" />
                    Copy caption
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <Button variant="outline" onClick={shareGraphic} className="gap-2">
                    <Share2 className="w-4 h-4" />
                    Share image
                  </Button>
                  <Button variant="outline" onClick={openXComposer} className="gap-2">
                    <Send className="w-4 h-4" />
                    Open X
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Select a signal.</p>
            )}
          </section>

          {selected && (
            <section className="rounded-lg border border-border bg-card p-4 space-y-3">
              <div>
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Caption
                </label>
                <Textarea
                  value={caption}
                  onChange={(event) => setCaption(event.target.value)}
                  className="mt-2 min-h-28"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={saveCaption} disabled={updateMutation.isPending}>
                  Save caption
                </Button>
                <a
                  href={selected.targetPath}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                >
                  <ExternalLink className="w-4 h-4" />
                  Open target
                </a>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-1">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setStatus("approved")}>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Approve
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setStatus("scheduled")}>
                  <CalendarClock className="w-3.5 h-3.5" />
                  Queue
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setStatus("archived")}>
                  <Archive className="w-3.5 h-3.5" />
                  Archive
                </Button>
              </div>
              <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={markPosted} disabled={updateMutation.isPending}>
                <Send className="w-3.5 h-3.5" />
                Mark posted
              </Button>
            </section>
          )}
        </aside>
      </div>
    </AdminLayout>
  );
}
