import {
  MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Clapperboard,
  Download,
  Film,
  Gauge,
  Monitor,
  MousePointerClick,
  Play,
  Plus,
  RefreshCcw,
  SlidersHorizontal,
  Sparkles,
  Square,
  Timer,
  Trash2,
  Video,
  WandSparkles,
} from "lucide-react";
import AdminLayout from "./AdminLayout";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import {
  CameraEasing,
  CameraFocusPoint,
  EXPORT_PRESETS,
  STARTER_CAMERA_POINTS,
  VIDEO_DEMO_PRESETS,
  createCameraPointId,
  formatDuration,
  formatTimestamp,
} from "@/lib/video-studio";

type RecordingStatus = "idle" | "recording" | "preview";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function getSupportedMimeType() {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) {
    return "";
  }

  return (
    [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ].find((type) => MediaRecorder.isTypeSupported(type)) ?? ""
  );
}

function RecordingPanel() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingUrlRef = useRef<string | null>(null);
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  useEffect(() => {
    recordingUrlRef.current = recordingUrl;
  }, [recordingUrl]);

  useEffect(() => {
    if (status !== "recording" || startedAt == null) return undefined;

    const intervalId = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 250);

    return () => window.clearInterval(intervalId);
  }, [startedAt, status]);

  useEffect(() => {
    return () => {
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (recordingUrlRef.current) {
        URL.revokeObjectURL(recordingUrlRef.current);
      }
    };
  }, []);

  const setFreshRecordingUrl = useCallback((url: string | null) => {
    setRecordingUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return url;
    });
  }, []);

  const startRecording = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
      toast.error("This browser cannot record tabs or windows.");
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      toast.error("MediaRecorder is not available in this browser.");
      return;
    }

    try {
      setFreshRecordingUrl(null);
      chunksRef.current = [];
      setElapsedMs(0);

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      recorderRef.current = recorder;
      streamRef.current = stream;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setStartedAt(null);

        const blob = new Blob(chunksRef.current, { type: mimeType || "video/webm" });
        chunksRef.current = [];

        if (blob.size === 0) {
          setStatus("idle");
          toast.warning("Recording stopped without video data.");
          return;
        }

        const url = URL.createObjectURL(blob);
        setFreshRecordingUrl(url);
        setStatus("preview");
        toast.success("Recording ready for preview");
      };

      stream.getVideoTracks().forEach((track) => {
        track.addEventListener("ended", () => {
          if (recorder.state !== "inactive") recorder.stop();
        });
      });

      recorder.start(1000);
      setStartedAt(Date.now());
      setStatus("recording");
      toast.success("Recording started");
    } catch (error) {
      setStatus("idle");
      setStartedAt(null);
      toast.error(getErrorMessage(error, "Could not start recording"));
    }
  }, [setFreshRecordingUrl]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }, []);

  const clearRecording = useCallback(() => {
    setFreshRecordingUrl(null);
    setStatus("idle");
    setElapsedMs(0);
    setStartedAt(null);
  }, [setFreshRecordingUrl]);

  const downloadRecording = useCallback(() => {
    if (!recordingUrl) return;

    const anchor = document.createElement("a");
    anchor.href = recordingUrl;
    anchor.download = `collectiblez-recording-${Date.now()}.webm`;
    anchor.click();
  }, [recordingUrl]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-xl">Manual recorder</CardTitle>
            <CardDescription>Capture a browser tab, app window, or screen into a raw WebM clip.</CardDescription>
          </div>
          <Badge variant={status === "recording" ? "default" : "secondary"} className="capitalize">
            {status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="overflow-hidden rounded-md border border-border/60 bg-muted/20">
          {recordingUrl ? (
            <video src={recordingUrl} controls className="aspect-video w-full bg-black object-contain" />
          ) : (
            <div className="flex aspect-video flex-col items-center justify-center gap-3 p-6 text-center">
              <Video className="size-9 text-muted-foreground" />
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">No recording yet</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Start capture, pick the Collectiblez tab, then stop when the demo moment is done.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="flex items-center gap-3 rounded-md border border-border/60 bg-background px-3 py-2">
            <Timer className="size-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium tabular-nums">{formatDuration(elapsedMs)}</span>
                <span className="text-xs text-muted-foreground">Target: 15-30 seconds</span>
              </div>
              <Progress value={Math.min(100, (elapsedMs / 30_000) * 100)} className="mt-2 h-1.5" />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {status === "recording" ? (
              <Button type="button" variant="destructive" onClick={stopRecording}>
                <Square data-icon="inline-start" />
                Stop
              </Button>
            ) : (
              <Button type="button" onClick={startRecording}>
                <Play data-icon="inline-start" />
                Start recording
              </Button>
            )}
            <Button type="button" variant="outline" onClick={downloadRecording} disabled={!recordingUrl || status === "recording"}>
              <Download data-icon="inline-start" />
              Download
            </Button>
            <Button type="button" variant="ghost" onClick={clearRecording} disabled={status === "recording" && !recordingUrl}>
              <RefreshCcw data-icon="inline-start" />
              Reset
            </Button>
          </div>
        </div>

        <Alert>
          <AlertTriangle />
          <AlertTitle>Browser capture uses the native permission prompt</AlertTitle>
          <AlertDescription>
            The app cannot silently record the screen. That is good security, and it keeps this admin tool safe to use.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

function DemoPresetPanel() {
  const [selectedPresetId, setSelectedPresetId] = useState(VIDEO_DEMO_PRESETS[0]?.id ?? "");
  const selectedPreset = useMemo(
    () => VIDEO_DEMO_PRESETS.find((preset) => preset.id === selectedPresetId) ?? VIDEO_DEMO_PRESETS[0],
    [selectedPresetId],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Auto demo presets</CardTitle>
        <CardDescription>Reusable Playwright scripts will turn these flows into repeatable product demos.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-3 lg:grid-cols-3">
          {VIDEO_DEMO_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setSelectedPresetId(preset.id)}
              className={cn(
                "rounded-md border p-4 text-left transition-colors",
                selectedPreset?.id === preset.id
                  ? "border-primary bg-primary/5"
                  : "border-border/60 hover:border-primary/40 hover:bg-muted/30",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <Clapperboard className="mt-0.5 size-4 text-muted-foreground" />
                <Badge variant="secondary">{preset.aspectRatio}</Badge>
              </div>
              <p className="mt-3 text-sm font-semibold">{preset.title}</p>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{preset.description}</p>
              <p className="mt-3 text-xs text-muted-foreground">
                {preset.route} - about {preset.expectedLengthSeconds}s
              </p>
            </button>
          ))}
        </div>

        {selectedPreset && (
          <div className="rounded-md border border-border/60">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 p-4">
              <div>
                <p className="text-sm font-semibold">{selectedPreset.title}</p>
                <p className="text-sm text-muted-foreground">{selectedPreset.description}</p>
              </div>
              <Button type="button" variant="outline" disabled>
                <WandSparkles data-icon="inline-start" />
                Generate script
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[90px]">Step</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead className="w-[110px]">Timing</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedPreset.steps.map((step, index) => (
                  <TableRow key={step.id}>
                    <TableCell className="font-medium tabular-nums">{index + 1}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-medium">{step.label}</span>
                        <Badge variant="outline" className="w-fit capitalize">
                          {step.kind}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate text-muted-foreground">
                      {step.target ?? step.value ?? "Auto"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {step.durationMs ? `${step.durationMs}ms` : "Auto"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CameraPathPanel() {
  const [cameraPoints, setCameraPoints] = useState<CameraFocusPoint[]>(STARTER_CAMERA_POINTS);
  const [activePointId, setActivePointId] = useState(STARTER_CAMERA_POINTS[1]?.id ?? STARTER_CAMERA_POINTS[0]?.id ?? "");

  const activePoint = useMemo(
    () => cameraPoints.find((point) => point.id === activePointId) ?? cameraPoints[0],
    [activePointId, cameraPoints],
  );

  const updatePoint = useCallback((pointId: string, patch: Partial<CameraFocusPoint>) => {
    setCameraPoints((points) =>
      points
        .map((point) => (point.id === pointId ? { ...point, ...patch } : point))
        .sort((a, b) => a.timeMs - b.timeMs),
    );
  }, []);

  const addPoint = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const xPct = ((event.clientX - rect.left) / rect.width) * 100;
    const yPct = ((event.clientY - rect.top) / rect.height) * 100;

    const nextTimeMs = Math.max(...cameraPoints.map((point) => point.timeMs), 0) + 1400;
    const nextPoint: CameraFocusPoint = {
      id: createCameraPointId(),
      label: `Focus ${cameraPoints.length + 1}`,
      timeMs: nextTimeMs,
      xPct: Math.round(xPct),
      yPct: Math.round(yPct),
      zoom: 1.32,
      easing: "ease-out",
    };

    setCameraPoints([...cameraPoints, nextPoint].sort((a, b) => a.timeMs - b.timeMs));
    setActivePointId(nextPoint.id);
  }, [cameraPoints]);

  const resetPoints = useCallback(() => {
    setCameraPoints(STARTER_CAMERA_POINTS);
    setActivePointId(STARTER_CAMERA_POINTS[1]?.id ?? STARTER_CAMERA_POINTS[0]?.id ?? "");
  }, []);

  const deletePoint = useCallback((pointId: string) => {
    if (cameraPoints.length <= 1) return;
    const nextPoints = cameraPoints.filter((point) => point.id !== pointId);
    setCameraPoints(nextPoints);
    if (activePointId === pointId) {
      setActivePointId(nextPoints[0]?.id ?? "");
    }
  }, [activePointId, cameraPoints]);

  const cameraFrameStyle = activePoint
    ? {
        left: `${activePoint.xPct}%`,
        top: `${activePoint.yPct}%`,
        width: `${Math.max(32, 84 / activePoint.zoom)}%`,
        height: `${Math.max(26, 48 / activePoint.zoom)}%`,
        transform: "translate(-50%, -50%)",
      }
    : undefined;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-xl">Click-follow camera path</CardTitle>
            <CardDescription>Click the preview to create zoom targets for a polished Screen Studio-style edit.</CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={resetPoints}>
            <RefreshCcw data-icon="inline-start" />
            Reset path
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={addPoint}
            className="relative aspect-video overflow-hidden rounded-md border border-border/60 bg-background text-left shadow-sm"
            aria-label="Add camera focus point"
          >
            <div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--border))_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border))_1px,transparent_1px)] bg-[size:48px_48px] opacity-30" />
            <div className="absolute left-[7%] top-[12%] h-[7%] w-[46%] rounded bg-muted" />
            <div className="absolute right-[8%] top-[12%] h-[7%] w-[22%] rounded bg-primary/20" />
            <div className="absolute left-[7%] top-[28%] h-[48%] w-[40%] rounded-md border border-border/70 bg-card shadow-sm" />
            <div className="absolute right-[8%] top-[28%] h-[48%] w-[36%] rounded-md border border-border/70 bg-card shadow-sm" />
            <div className="absolute left-[11%] top-[35%] h-[8%] w-[28%] rounded bg-muted" />
            <div className="absolute left-[11%] top-[49%] h-[7%] w-[18%] rounded bg-primary/25" />
            <div className="absolute right-[12%] top-[36%] h-[7%] w-[22%] rounded bg-muted" />
            <div className="absolute right-[12%] top-[51%] h-[7%] w-[26%] rounded bg-muted" />
            <div className="absolute right-[12%] top-[66%] h-[8%] w-[18%] rounded bg-primary/25" />

            {cameraPoints.map((point) => (
              <span
                key={point.id}
                className={cn(
                  "absolute size-3 rounded-full border-2 border-background shadow-sm",
                  point.id === activePoint?.id ? "bg-primary" : "bg-muted-foreground",
                )}
                style={{ left: `${point.xPct}%`, top: `${point.yPct}%`, transform: "translate(-50%, -50%)" }}
              />
            ))}

            {cameraFrameStyle && (
              <span
                className="absolute rounded-md border-2 border-primary shadow-[0_0_0_999px_hsl(var(--background)/0.42)] transition-all"
                style={cameraFrameStyle}
              />
            )}

            <span className="absolute bottom-3 left-3 rounded-md border border-border/60 bg-background/90 px-3 py-1.5 text-xs font-medium shadow-sm">
              Click anywhere to add a focus point
            </span>
          </button>

          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-border/60 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Points</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{cameraPoints.length}</p>
            </div>
            <div className="rounded-md border border-border/60 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active zoom</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{activePoint?.zoom.toFixed(2) ?? "1.00"}x</p>
            </div>
            <div className="rounded-md border border-border/60 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Render style</p>
              <p className="mt-1 text-sm font-semibold">Smooth pan</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-md border border-border/60">
            <div className="border-b border-border/60 p-3">
              <p className="text-sm font-semibold">Timeline</p>
              <p className="text-xs text-muted-foreground">Focus points become Remotion keyframes.</p>
            </div>
            <div className="max-h-[280px] overflow-auto">
              {cameraPoints.map((point) => (
                <button
                  key={point.id}
                  type="button"
                  onClick={() => setActivePointId(point.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 border-b border-border/50 px-3 py-2 text-left last:border-b-0",
                    point.id === activePoint?.id ? "bg-primary/5" : "hover:bg-muted/30",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{point.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatTimestamp(point.timeMs)} - {Math.round(point.xPct)}%, {Math.round(point.yPct)}%
                    </span>
                  </span>
                  <Badge variant="secondary">{point.zoom.toFixed(2)}x</Badge>
                </button>
              ))}
            </div>
          </div>

          {activePoint && (
            <div className="flex flex-col gap-4 rounded-md border border-border/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="size-4 text-muted-foreground" />
                  <p className="text-sm font-semibold">Edit focus point</p>
                </div>
                <Button type="button" variant="ghost" size="icon" onClick={() => deletePoint(activePoint.id)} disabled={cameraPoints.length <= 1}>
                  <Trash2 />
                  <span className="sr-only">Delete focus point</span>
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="camera-label">Label</Label>
                  <Input
                    id="camera-label"
                    value={activePoint.label}
                    onChange={(event) => updatePoint(activePoint.id, { label: event.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="camera-time">Time ms</Label>
                  <Input
                    id="camera-time"
                    type="number"
                    min="0"
                    step="100"
                    value={activePoint.timeMs}
                    onChange={(event) => updatePoint(activePoint.id, { timeMs: Number(event.target.value) || 0 })}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="camera-zoom">Zoom</Label>
                  <span className="text-sm tabular-nums text-muted-foreground">{activePoint.zoom.toFixed(2)}x</span>
                </div>
                <Slider
                  id="camera-zoom"
                  min={1}
                  max={1.8}
                  step={0.01}
                  value={[activePoint.zoom]}
                  onValueChange={([value]) => updatePoint(activePoint.id, { zoom: value })}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="camera-x">X %</Label>
                  <Input
                    id="camera-x"
                    type="number"
                    min="0"
                    max="100"
                    value={Math.round(activePoint.xPct)}
                    onChange={(event) => updatePoint(activePoint.id, { xPct: Number(event.target.value) || 0 })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="camera-y">Y %</Label>
                  <Input
                    id="camera-y"
                    type="number"
                    min="0"
                    max="100"
                    value={Math.round(activePoint.yPct)}
                    onChange={(event) => updatePoint(activePoint.id, { yPct: Number(event.target.value) || 0 })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="camera-easing">Easing</Label>
                  <Select
                    value={activePoint.easing}
                    onValueChange={(value) => updatePoint(activePoint.id, { easing: value as CameraEasing })}
                  >
                    <SelectTrigger id="camera-easing">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ease-out">Ease out</SelectItem>
                      <SelectItem value="ease-in-out">Ease in/out</SelectItem>
                      <SelectItem value="linear">Linear</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ExportPlanPanel() {
  const [selectedExportId, setSelectedExportId] = useState(EXPORT_PRESETS[0]?.id ?? "");
  const selectedExport = EXPORT_PRESETS.find((preset) => preset.id === selectedExportId) ?? EXPORT_PRESETS[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Render queue plan</CardTitle>
        <CardDescription>Remotion will own final MP4 exports after raw capture and camera paths are saved.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <ToggleGroup
          type="single"
          value={selectedExportId}
          onValueChange={(value) => {
            if (value) setSelectedExportId(value);
          }}
          className="grid grid-cols-1 justify-stretch gap-2 sm:grid-cols-3"
        >
          {EXPORT_PRESETS.map((preset) => (
            <ToggleGroupItem key={preset.id} value={preset.id} className="h-auto flex-col items-start gap-1 p-3 text-left">
              <span className="text-sm font-semibold">{preset.label}</span>
              <span className="text-xs text-muted-foreground">
                {preset.ratio} - {preset.width}x{preset.height}
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-md border border-border/60 p-4">
            <Monitor className="size-4 text-muted-foreground" />
            <p className="mt-3 text-sm font-semibold">{selectedExport?.channel}</p>
            <p className="text-sm text-muted-foreground">Primary destination</p>
          </div>
          <div className="rounded-md border border-border/60 p-4">
            <Gauge className="size-4 text-muted-foreground" />
            <p className="mt-3 text-sm font-semibold">1080p template</p>
            <p className="text-sm text-muted-foreground">Branded intro, captions, CTA</p>
          </div>
          <div className="rounded-md border border-border/60 p-4">
            <Film className="size-4 text-muted-foreground" />
            <p className="mt-3 text-sm font-semibold">Queued render</p>
            <p className="text-sm text-muted-foreground">Backend worker next</p>
          </div>
        </div>

        <Separator />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4" />
            Camera path data is ready for Remotion keyframes.
          </div>
          <Button type="button" disabled>
            <Sparkles data-icon="inline-start" />
            Render MP4
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminVideoStudio() {
  return (
    <AdminLayout>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <MousePointerClick className="size-4" />
              Click-follow camera editor
            </div>
            <div>
              <h1 className="text-2xl font-bold">Video Studio</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Record the real UI, plan repeatable demos, and turn click moments into premium camera moves.
              </p>
            </div>
          </div>
          <Button type="button" variant="outline" disabled>
            <Clapperboard data-icon="inline-start" />
            V1 spec saved
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-md border border-border/60 p-4">
            <Video className="size-4 text-muted-foreground" />
            <p className="mt-3 text-sm font-semibold">Manual capture</p>
            <p className="text-sm text-muted-foreground">Native tab recording with local preview and download.</p>
          </div>
          <div className="rounded-md border border-border/60 p-4">
            <Clapperboard className="size-4 text-muted-foreground" />
            <p className="mt-3 text-sm font-semibold">Scripted demos</p>
            <p className="text-sm text-muted-foreground">Playwright presets for launches and repeatable product clips.</p>
          </div>
          <div className="rounded-md border border-border/60 p-4">
            <MousePointerClick className="size-4 text-muted-foreground" />
            <p className="mt-3 text-sm font-semibold">Camera keyframes</p>
            <p className="text-sm text-muted-foreground">Editable focus points for smooth pan and zoom renders.</p>
          </div>
        </div>

        <Tabs defaultValue="record" className="flex flex-col gap-4">
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="record">Record</TabsTrigger>
            <TabsTrigger value="presets">Demo presets</TabsTrigger>
            <TabsTrigger value="camera">Camera path</TabsTrigger>
            <TabsTrigger value="export">Export</TabsTrigger>
          </TabsList>
          <TabsContent value="record">
            <RecordingPanel />
          </TabsContent>
          <TabsContent value="presets">
            <DemoPresetPanel />
          </TabsContent>
          <TabsContent value="camera">
            <CameraPathPanel />
          </TabsContent>
          <TabsContent value="export">
            <ExportPlanPanel />
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
