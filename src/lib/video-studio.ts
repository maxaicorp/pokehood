export type DemoStepKind = "navigate" | "click" | "scroll" | "wait" | "type";

export type DemoStep = {
  id: string;
  kind: DemoStepKind;
  label: string;
  target?: string;
  value?: string;
  durationMs?: number;
};

export type VideoDemoPreset = {
  id: string;
  title: string;
  route: string;
  description: string;
  aspectRatio: "9:16" | "1:1" | "16:9";
  expectedLengthSeconds: number;
  steps: DemoStep[];
};

export type CameraEasing = "linear" | "ease-out" | "ease-in-out";

export type CameraFocusPoint = {
  id: string;
  label: string;
  timeMs: number;
  xPct: number;
  yPct: number;
  zoom: number;
  easing: CameraEasing;
};

export type ExportPreset = {
  id: string;
  label: string;
  ratio: "9:16" | "1:1" | "16:9";
  width: number;
  height: number;
  channel: string;
};

export const VIDEO_DEMO_PRESETS: VideoDemoPreset[] = [
  {
    id: "gacha-pack-launch",
    title: "Gacha pack launch",
    route: "/gacha",
    description: "A fast launch clip for the $50 and $100 mystery pack flow.",
    aspectRatio: "9:16",
    expectedLengthSeconds: 22,
    steps: [
      { id: "gacha-1", kind: "navigate", label: "Open mystery packs", target: "/gacha" },
      { id: "gacha-2", kind: "click", label: "Select Premium $100 pack", target: "[data-pack='premium-100']" },
      { id: "gacha-3", kind: "wait", label: "Hold on pack art", durationMs: 900 },
      { id: "gacha-4", kind: "click", label: "Focus wallet panel", target: "[data-video-focus='wallet-panel']" },
      { id: "gacha-5", kind: "scroll", label: "Reveal odds and CTA", target: "[data-video-focus='odds-panel']" },
    ],
  },
  {
    id: "market-card-search",
    title: "Market card search",
    route: "/",
    description: "Shows discovery, card detail, and the market signal workflow.",
    aspectRatio: "16:9",
    expectedLengthSeconds: 28,
    steps: [
      { id: "market-1", kind: "navigate", label: "Open market home", target: "/" },
      { id: "market-2", kind: "type", label: "Search a chase card", target: "input[type='search']", value: "Charizard" },
      { id: "market-3", kind: "wait", label: "Let results settle", durationMs: 1000 },
      { id: "market-4", kind: "click", label: "Open card detail", target: "[data-video-focus='card-result']:first" },
      { id: "market-5", kind: "scroll", label: "Show sentiment and price signal", target: "[data-video-focus='market-signal']" },
    ],
  },
  {
    id: "set-page-scroll",
    title: "Set page scroll",
    route: "/sets",
    description: "A collector-friendly pass through set pages and card grids.",
    aspectRatio: "1:1",
    expectedLengthSeconds: 24,
    steps: [
      { id: "sets-1", kind: "navigate", label: "Open set index", target: "/sets" },
      { id: "sets-2", kind: "click", label: "Open featured set", target: "[data-video-focus='set-card']:first" },
      { id: "sets-3", kind: "wait", label: "Hold on set header", durationMs: 700 },
      { id: "sets-4", kind: "scroll", label: "Scroll card grid", target: "[data-video-focus='set-grid']" },
      { id: "sets-5", kind: "click", label: "Open a card", target: "[data-video-focus='set-card-item']:first" },
    ],
  },
];

export const STARTER_CAMERA_POINTS: CameraFocusPoint[] = [
  {
    id: "intro-wide",
    label: "Wide intro",
    timeMs: 0,
    xPct: 50,
    yPct: 48,
    zoom: 1,
    easing: "ease-in-out",
  },
  {
    id: "first-click",
    label: "First click zoom",
    timeMs: 1500,
    xPct: 66,
    yPct: 38,
    zoom: 1.34,
    easing: "ease-out",
  },
  {
    id: "detail-panel",
    label: "Detail panel",
    timeMs: 3400,
    xPct: 74,
    yPct: 61,
    zoom: 1.48,
    easing: "ease-in-out",
  },
  {
    id: "cta-ending",
    label: "CTA ending",
    timeMs: 5700,
    xPct: 50,
    yPct: 50,
    zoom: 1.08,
    easing: "ease-out",
  },
];

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: "vertical", label: "Vertical", ratio: "9:16", width: 1080, height: 1920, channel: "TikTok, Reels, Shorts" },
  { id: "square", label: "Square", ratio: "1:1", width: 1080, height: 1080, channel: "Instagram, X" },
  { id: "wide", label: "Wide", ratio: "16:9", width: 1920, height: 1080, channel: "YouTube, launch pages" },
];

export function formatTimestamp(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const deciseconds = Math.floor((Math.max(0, ms) % 1000) / 100);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${deciseconds}`;
}

export function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function createCameraPointId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `point-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
