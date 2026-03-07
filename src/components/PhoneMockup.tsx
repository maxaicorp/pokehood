export default function PhoneMockup({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mx-auto w-[280px] md:w-[300px]">
      {/* Phone frame */}
      <div className="relative rounded-[40px] border-[6px] border-foreground/20 bg-background shadow-2xl overflow-hidden">
        {/* Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-28 h-6 bg-foreground/20 rounded-b-2xl z-20" />
        {/* Screen */}
        <div className="relative overflow-hidden rounded-[34px]">
          {children}
        </div>
        {/* Home indicator */}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-28 h-1 bg-foreground/20 rounded-full" />
      </div>
    </div>
  );
}
