import { PokemonCard, searchCards } from "./pokemon-api";

export interface CsvRow {
  name: string;
  setName?: string;
  quantity?: number;
  condition?: string;
  number?: string;
}

export function parseCsv(text: string): CsvRow[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];

  const header = lines[0].toLowerCase().split(",").map(h => h.trim().replace(/"/g, ""));
  const nameIdx = header.findIndex(h => h === "name" || h === "card name" || h === "product name");
  const setIdx = header.findIndex(h => h === "set" || h === "set name" || h === "expansion");
  const qtyIdx = header.findIndex(h => h === "quantity" || h === "qty" || h === "count");
  const condIdx = header.findIndex(h => h === "condition" || h === "cond");
  const numIdx = header.findIndex(h => h === "number" || h === "card number" || h === "collector number");

  if (nameIdx === -1) return [];

  return lines.slice(1).map(line => {
    const cols = parseCsvLine(line);
    return {
      name: cols[nameIdx]?.trim() || "",
      setName: setIdx >= 0 ? cols[setIdx]?.trim() : undefined,
      quantity: qtyIdx >= 0 ? parseInt(cols[qtyIdx]) || 1 : 1,
      condition: condIdx >= 0 ? cols[condIdx]?.trim() : "NM",
      number: numIdx >= 0 ? cols[numIdx]?.trim() : undefined,
    };
  }).filter(r => r.name);
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

export interface ImportResult {
  found: { row: CsvRow; card: PokemonCard }[];
  notFound: CsvRow[];
}

export async function resolveImport(rows: CsvRow[]): Promise<ImportResult> {
  const found: { row: CsvRow; card: PokemonCard }[] = [];
  const notFound: CsvRow[] = [];

  // Batch by unique names to reduce API calls
  const uniqueNames = [...new Set(rows.map(r => r.name))];

  const cardMap = new Map<string, PokemonCard[]>();

  for (const name of uniqueNames) {
    try {
      const result = await searchCards(name, 1, 10);
      if (result.data.length > 0) {
        cardMap.set(name.toLowerCase(), result.data);
      }
    } catch {
      // skip on error
    }
    // Rate limit - pokemontcg.io has limits
    await new Promise(r => setTimeout(r, 200));
  }

  for (const row of rows) {
    const candidates = cardMap.get(row.name.toLowerCase());
    if (!candidates || candidates.length === 0) {
      notFound.push(row);
      continue;
    }

    // Try to match by set name and card number
    let match = candidates[0];
    if (row.setName) {
      const setMatch = candidates.find(c =>
        c.set.name.toLowerCase().includes(row.setName!.toLowerCase())
      );
      if (setMatch) match = setMatch;
    }
    if (row.number) {
      const numMatch = candidates.find(c => c.number === row.number);
      if (numMatch) match = numMatch;
    }

    found.push({ row, card: match });
  }

  return { found, notFound };
}
