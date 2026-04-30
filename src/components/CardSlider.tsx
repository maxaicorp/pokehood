import { Marquee } from "@/components/ui/marquee";
import { BlurFade } from "@/components/ui/blur-fade";

// Curated cards — Scrydex CDN only. No fallbacks: a 404 here means Scrydex
// changed a URL and we want to know about it, not silently swap to TCGdex.
const SLIDER_CARDS = [
  // Surging Sparks (sv08)
  "https://cdn.scrydex.com/pokemon/en/sv08/131/small.webp",
  "https://cdn.scrydex.com/pokemon/en/sv08/196/small.webp",
  "https://cdn.scrydex.com/pokemon/en/sv08/190/small.webp",
  "https://cdn.scrydex.com/pokemon/en/sv08/141/small.webp",
  "https://cdn.scrydex.com/pokemon/en/sv08/225/small.webp",
  // Stellar Crown (sv07)
  "https://cdn.scrydex.com/pokemon/en/sv07/155/small.webp",
  "https://cdn.scrydex.com/pokemon/en/sv07/142/small.webp",
  "https://cdn.scrydex.com/pokemon/en/sv07/091/small.webp",
  // Twilight Masquerade (sv06)
  "https://cdn.scrydex.com/pokemon/en/sv06/167/small.webp",
  "https://cdn.scrydex.com/pokemon/en/sv06/165/small.webp",
  "https://cdn.scrydex.com/pokemon/en/sv06/226/small.webp",
  // Temporal Forces (sv05)
  "https://cdn.scrydex.com/pokemon/en/sv05/192/small.webp",
  "https://cdn.scrydex.com/pokemon/en/sv05/171/small.webp",
  "https://cdn.scrydex.com/pokemon/en/sv05/095/small.webp",
];

export default function CardSlider() {
  return (
    <BlurFade delay={0.25} inView className="overflow-hidden marquee-fade">
      <Marquee pauseOnHover className="[--duration:50s]">
        {SLIDER_CARDS.map((src, i) => (
          <div
            key={i}
            className="w-[200px] sm:w-[230px] md:w-[260px] rounded-xl overflow-hidden shadow-md hover:shadow-xl hover:scale-[1.03] transition-all duration-300 mx-2"
          >
            <img src={src} alt="Pokémon card" className="w-full h-auto" loading="lazy" />
          </div>
        ))}
      </Marquee>
    </BlurFade>
  );
}
