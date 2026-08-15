import { DB_FORMAT_VERSION, type RawCard, type RawDatabase, type RawPrinting, type RawSet } from './types';

/** The subset of the YGOPRODeck API responses this project consumes. */
export interface ApiSet {
  set_name: string;
  set_code: string;
  num_of_cards?: number;
  tcg_date?: string;
}

export interface ApiCardSet {
  set_name: string;
  set_code: string;
  set_rarity: string;
  set_rarity_code?: string;
  set_price?: string;
}

export interface ApiCard {
  id: number;
  name: string;
  type: string;
  card_sets?: ApiCardSet[];
  card_images?: { id: number }[];
  card_prices?: { cardmarket_price?: string }[];
}

/** "1.35" -> 135. Missing, zero and unparseable prices all become 0 (= unknown). */
function priceToCents(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 100);
}

/** A printing's `set_code` is the card number (`LEDE-EN001`); the set's code is the prefix. */
export function setCodeFromCardNumber(cardNumber: string): string {
  const dash = cardNumber.indexOf('-');
  return (dash === -1 ? cardNumber : cardNumber.slice(0, dash)).toUpperCase().trim();
}

class StringTable {
  private readonly indices = new Map<string, number>();
  readonly values: string[] = [];

  intern(value: string): number {
    const existing = this.indices.get(value);
    if (existing !== undefined) return existing;
    const index = this.values.length;
    this.indices.set(value, index);
    this.values.push(value);
    return index;
  }
}

/**
 * Turns the two raw API responses into the compact index the app ships.
 *
 * Kept free of network access so it can be unit-tested against fixtures.
 */
export function buildIndex(apiCards: ApiCard[], apiSets: ApiSet[], generated = new Date()): RawDatabase {
  const sets: RawSet[] = [];
  const setIndexByName = new Map<string, number>();

  const addSet = (name: string, code: string, numOfCards: number, tcgDate: string): number => {
    const key = name.toLowerCase();
    const existing = setIndexByName.get(key);
    if (existing !== undefined) return existing;
    const index = sets.length;
    sets.push([name, code, numOfCards, tcgDate]);
    setIndexByName.set(key, index);
    return index;
  };

  for (const set of apiSets) {
    if (!set.set_name) continue;
    addSet(set.set_name, (set.set_code ?? '').toUpperCase().trim(), set.num_of_cards ?? 0, set.tcg_date ?? '');
  }

  const rarities = new StringTable();
  const types = new StringTable();
  const cards: RawCard[] = [];
  const aliases: [number, number][] = [];

  for (const card of apiCards) {
    if (!card.id || !card.name) continue;
    const cardIndex = cards.length;

    const printings: RawPrinting[] = [];
    const seen = new Set<string>();
    for (const printing of card.card_sets ?? []) {
      if (!printing.set_name) continue;
      // cardsets.php occasionally lacks a set that cardinfo.php references; keep the
      // printing rather than dropping a card's only source of truth.
      const setIndex = addSet(printing.set_name, setCodeFromCardNumber(printing.set_code ?? ''), 0, '');
      const rarityIndex = rarities.intern(printing.set_rarity || 'Unknown');
      const key = `${setIndex}:${rarityIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      printings.push([setIndex, rarityIndex]);
    }

    cards.push([
      card.id,
      card.name,
      types.intern(card.type || 'Unknown'),
      priceToCents(card.card_prices?.[0]?.cardmarket_price),
      printings,
    ]);

    // Alt-artwork printings carry their own passcode, and .ydk files use them.
    for (const image of card.card_images ?? []) {
      if (image.id && image.id !== card.id) aliases.push([image.id, cardIndex]);
    }
  }

  return {
    v: DB_FORMAT_VERSION,
    generated: generated.toISOString(),
    rarities: rarities.values,
    types: types.values,
    sets,
    cards,
    aliases,
  };
}
