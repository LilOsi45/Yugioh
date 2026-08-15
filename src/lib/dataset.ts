import { classifyProduct, isGuaranteed } from './setClassification';
import { normalizeName } from './normalize';
import { DB_FORMAT_VERSION, type Card, type Database, type Printing, type RawDatabase, type SetInfo } from './types';

const EXTRA_DECK_MARKERS = ['fusion', 'synchro', 'xyz', 'link'];

function isExtraDeckType(type: string): boolean {
  const lower = type.toLowerCase();
  return EXTRA_DECK_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Expands the shipped index into the object model the app works with.
 *
 * Product classification happens here rather than in the index so the heuristics
 * can be improved without refetching several megabytes of card data.
 */
export function decodeDatabase(raw: RawDatabase): Database {
  if (raw.v !== DB_FORMAT_VERSION) {
    throw new Error(
      `Card index has format version ${raw.v}, this build expects ${DB_FORMAT_VERSION}. Run \`npm run fetch-data\`.`,
    );
  }

  const sets: SetInfo[] = raw.sets.map(([name, code, numOfCards, tcgDate], index) => {
    const product = classifyProduct(name, code, numOfCards);
    return {
      index,
      name,
      code,
      numOfCards,
      tcgDate: tcgDate || null,
      product,
      guaranteed: isGuaranteed(product),
    };
  });

  const byPasscode = new Map<number, Card>();
  const byName = new Map<string, Card>();

  const cards: Card[] = raw.cards.map(([id, name, typeIndex, priceCents, rawPrintings]) => {
    const printings: Printing[] = [];
    for (const [setIndex, rarityIndex] of rawPrintings) {
      const set = sets[setIndex];
      if (!set) continue;
      printings.push({ set, rarity: raw.rarities[rarityIndex] ?? 'Unknown' });
    }
    const type = raw.types[typeIndex] ?? 'Unknown';
    const card: Card = { id, name, nameDe: null, type, priceCents, printings, extraDeck: isExtraDeckType(type) };
    byPasscode.set(id, card);
    byName.set(normalizeName(name), card);
    return card;
  });

  // German names are additional keys into the same cards, so a decklist typed in
  // either language resolves. The English key stays, it is never overwritten.
  for (const [cardIndex, germanName] of raw.de ?? []) {
    const card = cards[cardIndex];
    if (!card) continue;
    card.nameDe = germanName;
    const key = normalizeName(germanName);
    if (!byName.has(key)) byName.set(key, card);
  }

  for (const [passcode, cardIndex] of raw.aliases) {
    const card = cards[cardIndex];
    // A main passcode always wins over an alt-art alias pointing elsewhere.
    if (card && !byPasscode.has(passcode)) byPasscode.set(passcode, card);
  }

  return { generated: raw.generated, sets, cards, byPasscode, byName };
}

/** What to show the user: the German name when we have one. */
export function displayName(card: Card): string {
  return card.nameDe ?? card.name;
}

export const DATA_URL = 'data/db.json';

export class MissingDataError extends Error {
  constructor(url: string, cause?: unknown) {
    super(
      `Could not load the card index from ${url}. Run \`npm run fetch-data\` to download it from YGOPRODeck.`,
    );
    this.name = 'MissingDataError';
    this.cause = cause;
  }
}

/** Fetches and decodes the shipped index. Resolve `baseUrl` from `import.meta.env.BASE_URL`. */
export async function loadDatabase(baseUrl = '/'): Promise<Database> {
  const url = `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}${DATA_URL}`;
  let raw: RawDatabase;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    raw = (await response.json()) as RawDatabase;
  } catch (error) {
    throw new MissingDataError(url, error);
  }
  return decodeDatabase(raw);
}
