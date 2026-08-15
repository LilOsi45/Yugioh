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
}

main().catch((error: unknown) => {
  process.stderr.write(`\nfetch-data failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
