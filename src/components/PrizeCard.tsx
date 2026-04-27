// Shared card-style tile, visually matched to the CardMatch SlotTile front-face.
// Used to display giveaway prize art and (eventually) game prize art on Games.

interface PrizeCardProps {
  imageUrl?: string | null;
  alt?: string;
  className?: string;
}

export default function PrizeCard({ imageUrl, alt = "Prize", className = "" }: PrizeCardProps) {
  return (
    <div
      className={`relative aspect-[2.5/3.5] rounded-lg ring-1 ring-primary/30 overflow-hidden shadow-[0_8px_32px_-12px_hsl(var(--primary)/0.4)] ${className}`}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-primary/30 via-primary/10 to-background" />
      <div
        className="absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, hsl(var(--primary) / 0.25) 0%, transparent 65%)",
        }}
      />
      <div className="absolute inset-1.5 rounded-md border border-primary/25" />
      <div className="absolute inset-0 flex items-center justify-center p-3">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={alt}
            className="max-w-full max-h-full object-contain drop-shadow-[0_4px_12px_hsl(var(--primary)/0.3)]"
            draggable={false}
          />
        ) : (
          <img
            src="/logo.png"
            alt=""
            className="w-1/2 h-1/2 object-contain opacity-80 drop-shadow-[0_2px_6px_hsl(var(--primary)/0.4)]"
            draggable={false}
          />
        )}
      </div>
    </div>
  );
}
