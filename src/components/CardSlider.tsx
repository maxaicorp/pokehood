import { motion } from "framer-motion";

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
  // Duplicate for seamless loop
  const doubled = [...SLIDER_CARDS, ...SLIDER_CARDS];

  return (
    <motion.div
      className="overflow-hidden marquee-fade"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.8 }}
    >
      <div
        className="flex gap-5 w-max"
        style={{
          animation: "marquee-left 50s linear infinite",
        }}
      >
        {doubled.map((src, i) => (
          <div
            key={i}
            className="flex-shrink-0 w-[200px] sm:w-[230px] md:w-[260px] rounded-xl overflow-hidden shadow-md hover:shadow-xl hover:scale-[1.03] transition-all duration-300"
          >
            <img
              src={src}
              alt="Pokémon card"
              className="w-full h-auto"
              loading="lazy"
            />
          </div>
        ))}
      </div>
    </motion.div>
  );
}
