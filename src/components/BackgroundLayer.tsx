import { useBgTheme, type BgThemeId } from "./BackgroundThemeSwitcher";

/**
 * Full-screen fixed background layer that renders the selected texture.
 * Place once, high in the tree. All textures use CSS-only (no images).
 */
export default function BackgroundLayer() {
  const theme = useBgTheme();
  if (theme === "none") return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-0" aria-hidden>
      {theme === "noise" && <NoiseGrain />}
      {theme === "radial-glow" && <RadialGlow />}
      {theme === "dot-grid" && <DotGrid />}
      {theme === "mesh-gradient" && <MeshGradient />}
      {theme === "topographic" && <Topographic />}
      {theme === "aurora" && <Aurora />}
      {theme === "holographic" && <Holographic />}
      {theme === "vignette" && <Vignette />}
    </div>
  );
}

/* ─── 1. Noise Grain ─── */
function NoiseGrain() {
  return (
    <div className="absolute inset-0 opacity-[0.035] dark:opacity-[0.06]">
      <svg width="100%" height="100%">
        <filter id="noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#noise)" />
      </svg>
    </div>
  );
}

/* ─── 2. Radial Glow ─── */
function RadialGlow() {
  return (
    <div className="absolute inset-0">
      <div
        className="absolute top-[15%] left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full opacity-[0.08] dark:opacity-[0.12]"
        style={{
          background: "radial-gradient(circle, hsl(217 91% 60%) 0%, hsl(270 70% 60% / 0.5) 40%, transparent 70%)",
        }}
      />
      <div
        className="absolute bottom-[10%] left-[20%] w-[500px] h-[500px] rounded-full opacity-[0.05] dark:opacity-[0.08]"
        style={{
          background: "radial-gradient(circle, hsl(325 85% 55%) 0%, transparent 70%)",
        }}
      />
    </div>
  );
}

/* ─── 3. Dot Grid ─── */
function DotGrid() {
  return (
    <div
      className="absolute inset-0 opacity-[0.15] dark:opacity-[0.08]"
      style={{
        backgroundImage: "radial-gradient(circle, hsl(var(--foreground)) 0.8px, transparent 0.8px)",
        backgroundSize: "24px 24px",
      }}
    />
  );
}

/* ─── 4. Mesh Gradient ─── */
function MeshGradient() {
  return (
    <div className="absolute inset-0 opacity-[0.07] dark:opacity-[0.10]">
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(at 20% 30%, hsl(0 90% 65%) 0%, transparent 50%),
            radial-gradient(at 80% 20%, hsl(217 91% 60%) 0%, transparent 50%),
            radial-gradient(at 50% 80%, hsl(145 70% 45%) 0%, transparent 50%),
            radial-gradient(at 90% 70%, hsl(270 70% 60%) 0%, transparent 50%),
            radial-gradient(at 10% 90%, hsl(50 95% 55%) 0%, transparent 50%)
          `,
        }}
      />
    </div>
  );
}

/* ─── 5. Topographic Lines ─── */
function Topographic() {
  return (
    <div className="absolute inset-0 opacity-[0.06] dark:opacity-[0.08]">
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="topo" x="0" y="0" width="200" height="200" patternUnits="userSpaceOnUse">
            <circle cx="100" cy="100" r="20" fill="none" stroke="currentColor" strokeWidth="0.5" />
            <circle cx="100" cy="100" r="40" fill="none" stroke="currentColor" strokeWidth="0.5" />
            <circle cx="100" cy="100" r="60" fill="none" stroke="currentColor" strokeWidth="0.5" />
            <circle cx="100" cy="100" r="80" fill="none" stroke="currentColor" strokeWidth="0.5" />
            <circle cx="100" cy="100" r="95" fill="none" stroke="currentColor" strokeWidth="0.5" />
            <circle cx="0" cy="0" r="30" fill="none" stroke="currentColor" strokeWidth="0.5" />
            <circle cx="200" cy="200" r="45" fill="none" stroke="currentColor" strokeWidth="0.5" />
            <circle cx="200" cy="0" r="35" fill="none" stroke="currentColor" strokeWidth="0.5" />
            <circle cx="0" cy="200" r="55" fill="none" stroke="currentColor" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#topo)" className="text-foreground" />
      </svg>
    </div>
  );
}

/* ─── 6. Aurora / Northern Lights ─── */
function Aurora() {
  return (
    <div className="absolute inset-0 overflow-hidden opacity-[0.08] dark:opacity-[0.12]">
      <div
        className="absolute -top-1/2 left-0 w-[200%] h-[200%]"
        style={{
          background: `
            linear-gradient(135deg, 
              hsl(145 70% 45% / 0.6) 0%, 
              hsl(217 91% 60% / 0.4) 25%, 
              hsl(270 70% 60% / 0.5) 50%, 
              hsl(325 85% 55% / 0.3) 75%, 
              hsl(145 70% 45% / 0.4) 100%
            )
          `,
          animation: "aurora-shift 12s ease-in-out infinite alternate",
        }}
      />
    </div>
  );
}

/* ─── 7. Holographic Shimmer ─── */
function Holographic() {
  return (
    <div className="absolute inset-0 overflow-hidden opacity-[0.06] dark:opacity-[0.10]">
      <div
        className="absolute inset-0"
        style={{
          background: `
            linear-gradient(
              125deg,
              hsl(0 90% 65% / 0.5) 0%,
              hsl(50 95% 55% / 0.5) 15%,
              hsl(145 70% 45% / 0.5) 30%,
              hsl(217 91% 60% / 0.5) 45%,
              hsl(270 70% 60% / 0.5) 60%,
              hsl(325 85% 55% / 0.5) 75%,
              hsl(0 90% 65% / 0.5) 100%
            )
          `,
          backgroundSize: "200% 200%",
          animation: "holo-shift 6s ease-in-out infinite alternate",
        }}
      />
    </div>
  );
}

/* ─── 8. Vignette ─── */
function Vignette() {
  return (
    <div
      className="absolute inset-0"
      style={{
        background: "radial-gradient(ellipse at center, transparent 40%, hsl(var(--foreground) / 0.08) 100%)",
      }}
    />
  );
}
