export default function PhoneMockup({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mx-auto w-[300px] md:w-[360px]">
      {/* Outer shell — iPhone 15-style */}
      <div
        className="relative rounded-[44px] bg-[#1a1a1a] p-[10px] shadow-2xl"
        style={{
          boxShadow:
            "0 25px 50px -12px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.05) inset",
        }}
      >
        {/* Side button accents */}
        <div className="absolute -right-[2px] top-[110px] w-[3px] h-[46px] rounded-r bg-[#2a2a2a]" />
        <div className="absolute -left-[2px] top-[80px] w-[3px] h-[28px] rounded-l bg-[#2a2a2a]" />
        <div className="absolute -left-[2px] top-[120px] w-[3px] h-[46px] rounded-l bg-[#2a2a2a]" />
        <div className="absolute -left-[2px] top-[175px] w-[3px] h-[46px] rounded-l bg-[#2a2a2a]" />

        {/* Screen bezel */}
        <div className="relative rounded-[34px] overflow-hidden bg-white">
          {/* Dynamic Island */}
          <div className="absolute top-[10px] left-1/2 -translate-x-1/2 w-[90px] h-[24px] bg-[#1a1a1a] rounded-full z-20" />

          {/* Screen content */}
          <div className="relative h-[620px] overflow-hidden">
            {children}
          </div>

          {/* Home indicator */}
          <div className="absolute bottom-[6px] left-1/2 -translate-x-1/2 w-[100px] h-[4px] bg-[#1a1a1a] rounded-full" />
        </div>
      </div>
    </div>
  );
}
