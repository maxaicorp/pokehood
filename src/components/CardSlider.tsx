import { Marquee } from "@/components/ui/marquee";
import { BlurFade } from "@/components/ui/blur-fade";

// Curated cards from newer Scarlet & Violet sets (verified working IDs)
const SLIDER_CARDS = [
  // Surging Sparks (sv08)
  "https://assets.tcgdex.net/en/sv/sv08/131/high.webp",
  "https://assets.tcgdex.net/en/sv/sv08/196/high.webp",
  "https://assets.tcgdex.net/en/sv/sv08/190/high.webp",
  "https://assets.tcgdex.net/en/sv/sv08/141/high.webp",
  "https://assets.tcgdex.net/en/sv/sv08/225/high.webp",
  // Stellar Crown (sv07)
  "https://assets.tcgdex.net/en/sv/sv07/155/high.webp",
  "https://assets.tcgdex.net/en/sv/sv07/142/high.webp",
  "https://assets.tcgdex.net/en/sv/sv07/091/high.webp",
  // Twilight Masquerade (sv06)
  "https://assets.tcgdex.net/en/sv/sv06/167/high.webp",
  "https://assets.tcgdex.net/en/sv/sv06/165/high.webp",
  "https://assets.tcgdex.net/en/sv/sv06/226/high.webp",
  // Temporal Forces (sv05)
  "https://assets.tcgdex.net/en/sv/sv05/192/high.webp",
  "https://assets.tcgdex.net/en/sv/sv05/171/high.webp",
  "https://assets.tcgdex.net/en/sv/sv05/095/high.webp",
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
            <img
              src={src}
              alt="Pokémon card"
              className="w-full h-auto"
              loading="lazy"
            />
          </div>
        ))}
      </Marquee>
    </BlurFade>
  );
}
