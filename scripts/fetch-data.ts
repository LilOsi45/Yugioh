/**
 * Downloads the YGOPRODeck card database once and writes the compact index the app
 * ships (public/data/db.json).
 *
 * This runs at build time, never in the browser: the full card dump is ~100 MB of
 * JSON, and YGOPRODeck's rate limit is 20 requests per second with a one hour ban
 * for offenders. Two requests per refresh keeps us far inside that.
 *
 *   npm run fetch-data
 *
 * The generated file is gitignored — CI regenerates it weekly before deploying.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, type ApiCard, type ApiSet } from '../src/lib/buildIndex';
import { classifyAvailability, classifyProduct } from '../src/lib/setClassification';
import type { ProductClass, RawDatabase } from '../src/lib/types';

const API = 'https://db.ygoprodeck.com/api/v7';
const OUT_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data/db.json');

async function getJson<T>(url: string): Promise<T> {
  process.stdout.write(`  GET ${url}\n`);
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'ygo-set-finder (github.com/LilOsi45/Yugioh)' },
  });
  if (!response.ok) {
    throw new Error(`${url} responded ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

/**
 * Sets whose classification is worth watching, because they are the shapes the
 * prefix rules in setClassification.ts are meant to tell apart. Printed on every
 * refresh so a wrong verdict shows up in the log instead of in the UI.
 */
const SPOT_CHECKS: [setName: string, expected: ProductClass][] = [
  ['Structure Deck: The Crimson King', 'structure'],
  ['Structure Deck: Dark World', 'structure'],
  ['Starter Deck: Codebreaker', 'boxset'],
  // Fixed-content products whose codes match no prefix family; only the name says so.
  ['Egyptian God Deck: Slifer the Sky Dragon', 'boxset'],
  ['Noble Knights of the Round Table Box Set', 'boxset'],
  ['Legacy of Destruction', 'booster'],
  ['Phantom Nightmare', 'booster'],
  ['Legend of Blue Eyes White Dragon', 'booster'],
  ['25th Anniversary Tin: Dueling Mirrors', 'tin'],
  ['OTS Tournament Pack 27', 'promo'],
];

/**
 * The card data is fetched on a runner, not on a developer's machine, so this
 * summary in the build log is how anyone finds out whether the heuristics still
 * hold against the real database.
 */
function reportOnData(index: RawDatabase): void {
  const counts = new Map<ProductClass, number>();
  let upcoming = 0;
  for (const [name, code, numOfCards, tcgDate] of index.sets) {
    const product = classifyProduct(name, code, numOfCards);
    counts.set(product, (counts.get(product) ?? 0) + 1);
    if (classifyAvailability(tcgDate || null) === 'upcoming') upcoming += 1;
  }

  // Keyed by name, not code: several sets share a code (an original set and its
  // anniversary reprint both use LOB-EN###), which made an earlier version of this
  // check report a verdict for a different set than the one it named.
  const checks = SPOT_CHECKS.map(([setName, expected]) => {
    const match = index.sets.find(([name]) => name === setName);
    if (!match) return `    "${setName}": not in this dump`;
    const actual = classifyProduct(match[0], match[1], match[2]);
    const verdict = actual === expected ? '' : ` — EXPECTED ${expected}`;
    return `    ${match[1]}: ${actual}${verdict} ("${setName}")`;
  });

  // A big set filed as a promo is the signature of the size-based fallback rule
  // swallowing something it should not.
  const suspicious = index.sets
    .filter(([name, code, numOfCards]) => classifyProduct(name, code, numOfCards) === 'promo')
    .sort((a, b) => b[2] - a[2])
    .slice(0, 10)
    .map(([name, code, numOfCards]) => `    ${code}: ${numOfCards} cards, "${name}"`);

  process.stdout.write(
    `  set products: ${[...counts].map(([product, count]) => `${product}=${count}`).join(', ')}\n` +
      // The reprint radar has nothing to show if this is zero.
      `  sets not yet released: ${upcoming}\n` +
      `  spot checks:\n${checks.join('\n')}\n` +
      `  largest sets classified as promo:\n${suspicious.join('\n')}\n`,
  );
}

/**
 * What `card_sets[].set_price` actually contains, measured rather than assumed.
 *
 * The collection wants to show what a *printing* is worth — a Secret Rare and a
 * Common of the same card are wildly different — but the only per-card price we use
 * is Cardmarket's, which is one number for the card regardless of rarity. This
 * per-printing field is the only candidate for the difference, so before building
 * anything on it: is it filled in, and does its magnitude look like the Cardmarket
 * euro price or like something else entirely?
 */
function reportOnPrintingPrices(cards: ApiCard[]): void {
  let printings = 0;
  let priced = 0;

  for (const card of cards) {
    for (const printing of card.card_sets ?? []) {
      printings += 1;
      if (Number.parseFloat(printing.set_price ?? '0') > 0) priced += 1;
    }
  }

  /*
   * Cards printed at several rarities *in the same set* — exactly the case where the
   * app has to ask which one you own.
   *
   * Printing the set code per rarity answers a second question: does the code on the
   * card itself distinguish the rarities? If it did, the scanner could read the
   * rarity instead of asking. Identical codes across rarities mean it cannot.
   */
  const samples: string[] = [];
  for (const card of cards) {
    if (samples.length >= 4) break;
    const bySet = new Map<string, { rarity: string; price: string; code: string; rarityCode: string }[]>();
    for (const printing of card.card_sets ?? []) {
      const list = bySet.get(printing.set_code.split('-')[0] ?? '') ?? [];
      list.push({
        rarity: printing.set_rarity,
        price: printing.set_price ?? '',
        code: printing.set_code,
        rarityCode: printing.set_rarity_code ?? '',
      });
      bySet.set(printing.set_code.split('-')[0] ?? '', list);
    }
    const multi = [...bySet.entries()].find(
      ([, list]) => new Set(list.map((entry) => entry.rarity)).size >= 3,
    );
    const cardmarket = card.card_prices?.[0]?.cardmarket_price ?? '?';
    if (!multi) continue;
    samples.push(
      `    ${card.name} — cardmarket ${cardmarket}\n` +
        multi[1]
          .map(
            (entry) =>
              `      ${entry.rarity}: code ${entry.code}` +
              ` | rarity_code ${entry.rarityCode || '(leer)'}` +
              ` | price ${entry.price || '(leer)'}`,
          )
          .join('\n'),
    );
  }

  process.stdout.write(
    `  printing prices: ${priced} of ${printings} printings carry a set_price ` +
      `(${((priced / Math.max(1, printings)) * 100).toFixed(0)}%)\n` +
      `  same card at several rarities in one set:\n${samples.join('\n')}\n`,
  );
}

async function main(): Promise<void> {
  process.stdout.write('Fetching card data from YGOPRODeck...\n');

  const setsResponse = await getJson<ApiSet[]>(`${API}/cardsets.php`);
  const cardsResponse = await getJson<{ data: ApiCard[] }>(`${API}/cardinfo.php`);

  const apiCards = cardsResponse.data;
  if (!Array.isArray(apiCards) || apiCards.length === 0) {
    throw new Error('cardinfo.php returned no cards — aborting rather than shipping an empty index.');
  }

  // German names are a bonus, not a requirement: the app falls back to English
  // names everywhere, so a failure here must not cost us the whole refresh.
  let germanCards: { id: number; name: string }[] = [];
  try {
    const german = await getJson<{ data?: { id: number; name: string }[] }>(`${API}/cardinfo.php?language=de`);
    germanCards = german.data ?? [];
  } catch (error) {
    process.stdout.write(
      `  german names unavailable (${error instanceof Error ? error.message : String(error)}) — continuing in English\n`,
    );
  }

  const index = buildIndex(apiCards, setsResponse, new Date(), germanCards);
  const json = JSON.stringify(index);

  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, json, 'utf8');

  const printings = index.cards.reduce((sum, card) => sum + card[4].length, 0);
  process.stdout.write(
    `Wrote ${OUT_FILE}\n` +
      `  ${index.cards.length} cards, ${index.sets.length} sets, ${printings} printings, ` +
      `${index.aliases.length} alt-art passcodes, ${index.de?.length ?? 0} german names\n` +
      `  ${(json.length / 1024 / 1024).toFixed(1)} MB uncompressed\n`,
  );
  reportOnData(index);
  reportOnPrintingPrices(apiCards);
}

main().catch((error: unknown) => {
  process.stderr.write(`\nfetch-data failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
