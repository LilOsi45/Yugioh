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
const SPOT_CHECKS: [code: string, expected: ProductClass][] = [
  ['SDCK', 'structure'],
  ['SR13', 'structure'],
  ['YS18', 'boxset'],
  ['LEDE', 'booster'],
  ['PHNI', 'booster'],
  ['LOB', 'booster'],
  ['MP24', 'tin'],
  ['OP27', 'promo'],
];

/**
 * The card data is fetched on a runner, not on a developer's machine, so this
 * summary in the build log is how anyone finds out whether the heuristics still
 * hold against the real database.
 */
function reportOnData(index: RawDatabase): void {
  const counts = new Map<ProductClass, number>();
  let upcoming = 0;
  for (const [, code, numOfCards, tcgDate] of index.sets) {
    const product = classifyProduct(code, numOfCards);
    counts.set(product, (counts.get(product) ?? 0) + 1);
    if (classifyAvailability(tcgDate || null) === 'upcoming') upcoming += 1;
  }

  const byCode = new Map(index.sets.map(([, code, numOfCards]) => [code, { code, numOfCards }]));
  const checks = SPOT_CHECKS.map(([code, expected]) => {
    const set = byCode.get(code);
    if (!set) return `    ${code}: not in this dump`;
    const actual = classifyProduct(set.code, set.numOfCards);
    return `    ${code}: ${actual}${actual === expected ? '' : ` — EXPECTED ${expected}`}`;
  });

  process.stdout.write(
    `  set products: ${[...counts].map(([product, count]) => `${product}=${count}`).join(', ')}\n` +
      // The reprint radar has nothing to show if this is zero.
      `  sets not yet released: ${upcoming}\n` +
      `  spot checks:\n${checks.join('\n')}\n`,
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

  const index = buildIndex(apiCards, setsResponse);
  const json = JSON.stringify(index);

  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, json, 'utf8');

  const printings = index.cards.reduce((sum, card) => sum + card[4].length, 0);
  process.stdout.write(
    `Wrote ${OUT_FILE}\n` +
      `  ${index.cards.length} cards, ${index.sets.length} sets, ${printings} printings, ` +
      `${index.aliases.length} alt-art passcodes\n` +
      `  ${(json.length / 1024 / 1024).toFixed(1)} MB uncompressed\n`,
  );
  reportOnData(index);
}

main().catch((error: unknown) => {
  process.stderr.write(`\nfetch-data failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
