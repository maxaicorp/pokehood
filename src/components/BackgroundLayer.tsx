/**
 * Fixed full-screen topographic background texture.
 * CSS-only, no images required.
 */
export default function BackgroundLayer() {
  return (
    <div className="fixed inset-0 pointer-events-none z-0" aria-hidden>
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
    </div>
  );
}
