import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://api.scrydex.com/pokemon/v1';

async function main() {
  console.log('Fetching expansions...');
  const res = await fetch(`${BASE_URL}/expansions?pageSize=250`);
  const data = await res.json();
  
  const ascended = data.data.filter((e: any) => e.name.toLowerCase().includes('ascended'));
  
  if (ascended.length === 0) {
    console.log('Could not find Ascended Heroes set.');
    return;
  }
  
  const set = ascended[0];
  console.log(`Found expansion: ${set.name} (${set.id})`);
  
  console.log('Fetching first 100 cards...');
  const cardsRes1 = await fetch(`${BASE_URL}/cards?q=expansion.id:"${set.id}"&pageSize=100&page=1`);
  const cardsData1 = await cardsRes1.json();
  
  console.log(`Saved ${cardsData1.data.length} cards (Page 1)`);
  
  const dest = path.join(process.cwd(), 'ascended_heroes_page1.json');
  fs.writeFileSync(dest, JSON.stringify(cardsData1.data, null, 2));
  console.log(`Wrote to ${dest}`);
}

main().catch(console.error);
