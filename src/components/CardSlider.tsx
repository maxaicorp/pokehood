import { Marquee } from "@/components/ui/marquee";
import { BlurFade } from "@/components/ui/blur-fade";

// Curated cards — Scrydex CDN primary, TCGdex CDN fallback built into onError
const SLIDER_CARDS = [
  // Surging Sparks (sv08)
  { scrydex: "https://cdn.scrydex.com/pokemon/en/sv08/131/small.webp", tcgdex: "https://assets.tcgdex.net/en/sv/sv08/131/high.webp" },
  { scrydex: "https://cdn.scrydex.com/pokemon/en/sv08/196/small.webp", tcgdex: "https://assets.tcgdex.net/en/sv/sv08/196/high.webp" },
  { scrydex: "https://cdn.scrydex.com/pokemon/en/sv08/190/small.webp", tcgdex: "https://assets.tcgdex.net/en/sv/sv08/190/high.webp" },
  { scrydex: "https://cdn.scrydex.com/pokemon/en/sv08/141/small.webp", tcgdex: "https://assets.tcgdex.net/en/sv/sv08/141/high.webp" },
  { scrydex: "https://cdn.scrydex.com/pokemon/en/sv08/225/small.webp", tcgdex: "https://assets.tcgdex.net/en/sv/sv08/225/high.webp" },
  // Stellar Crown (sv07)
  { scrydex: "https://cdn.scrydex.com/pokemon/en/sv07/155/small.webp", tcgdex: "https://assets.tcgdex.net/en/sv/sv07/155/high.webp" },
  { scrydex: "https://cdn.scrydex.com/pokemon/en/sv07/142/small.webp", tcgdex: "https://assets.tcgdex.net/en/sv/sv07/142/high.webp" },
  { scrydex: "https://cdn.scrydex.com/pokemon/en/sv07/091/small.webp", tcgdex: "https://assets.tcgdex.net/en/sv/sv07/091/high.webp" },
  // Twilight Masquerade (sv06)
  { scrydex: "https://cdn.scrydex.com/pokemon/en/sv06/167/small.webp", tcgdex: "https://assets.tcgdex.net/en/sv/sv06/167/high.webp" },
  { scrydex: "https://cdn.scrydex.com/pokemon/en/sv06/165/small.webp", tcgdex: "https://assets.tcgdex.net/en/sv/sv06/165/high.webp" },
  { scrydex: "https://cdn.scrydex.com/pokemon/en/sv06/226/small.webp", tcgdex: "https://assets.tcgdex.net/en/sv/sv06/226/high.webp" },
  // Temporal Forces (sv05)
  { scrydex: "https://cdn.scrydex.com/pokemon/en/sv05/192/small.webp", tcgdex: "https://assets.tcgdex.net/en/sv/sv05/192/high.webp" },
  { scrydex: "https://cdn.scrydex.com/pokemon/en/sv05/171/small.webp", tcgdex: "https://assets.tcgdex.net/en/sv/sv05/171/high.webp" },
  { scrydex: "https://cdn.scrydex.com/pokemon/en/sv05/095/small.webp", tcgdex: "https://assets.tcgdex.net/en/sv/sv05/095/high.webp" },
];

export default function CardSlider() {
  return (
    <BlurFade delay={0.25} inView className="overflow-hidden marquee-fade">
      <Marquee pauseOnHover className="[--duration:50s]">
        {SLIDER_CARDS.map((card, i) => (
          <div
            key={i}
            className="w-[200px] sm:w-[230px] md:w-[260px] rounded-xl overflow-hidden shadow-md hover:shadow-xl hover:scale-[1.03] transition-all duration-300 mx-2"
          >
            <img
              src={card.scrydex}
              alt="Pokémon card"
              className="w-full h-auto"
              loading="lazy"
              onError={(e) => {
                const img = e.currentTarget;
                if (img.src !== card.tcgdex) {
                  img.src = card.tcgdex;
                }
              }}
            />
          </div>
        ))}
      </Marquee>
    </BlurFade>
  );
}
