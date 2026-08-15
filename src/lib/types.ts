/**
 * On-disk index format (public/data/db.json) and the decoded runtime model.
 *
 * The on-disk format uses positional arrays and string tables instead of objects
 * because the full YGOPRODeck dump is ~100 MB of JSON while this index is a few MB.
 * Everything the app needs is derived from it in the browser.
 */

export const DB_FORMAT_VERSION = 1;

/** `[setName, setCode, numOfCards, tcgDate]` — tcgDate is `""` when unknown. */
export type RawSet = [string, string, number, string];

/** `[setIndex, rarityIndex]` */
export type RawPrinting = [number, number];

/** `[passcode, name, typeIndex, cardmarketPriceCents, printings]` */
export type RawCard = [number, string, number, number, RawPrinting[]];

export interface RawDatabase {
  v: number;
  /** ISO timestamp of the data fetch. */
  generated: string;
  /** Deduplicated rarity names, referenced by index from printings. */
  rarities: string[];
  /** Deduplicated card type names, referenced by index from cards. */
  types: string[];
  sets: RawSet[];
  cards: RawCard[];
  /**
   * Alternate passcodes (alt artwork printings) mapped to their card's position
   * in `cards`. .ydk files routinely reference these instead of the main passcode.
   */
  aliases: [number, number][];
  /**
   * German card names by card position. Optional: YGOPRODeck's German data covers
   * fewer cards than the English set, and an index built before this existed simply
   * has no entry, so the app falls back to the English name.
   */
  de?: [number, string][];
}

/**
 * How you actually obtain cards from a product. This is the distinction that
 * decides whether "buy this set" is a plan or a gamble.
 */
export type ProductClass =
  | 'structure' // Structure/Starter Deck — fixed contents
  | 'boxset' // Speed Duel box, Battle Pack box, collector box — fixed contents
  | 'tin' // Mega Tin — fixed promos plus sealed packs
  | 'booster' // Random pulls, rarity decides the odds
  | 'promo' // Tournament/magazine/tin promos — not bought off a shelf
  | 'unknown';

export type Availability = 'upcoming' | 'current' | 'aging' | 'out-of-print' | 'unknown';

export interface SetInfo {
  /** Position in `RawDatabase.sets`, used as a stable key. */
  index: number;
  name: string;
  code: string;
  numOfCards: number;
  /** ISO date (YYYY-MM-DD) or null when YGOPRODeck has no date for the set. */
  tcgDate: string | null;
  product: ProductClass;
  /** True when contents are a fixed list, so buying one copy guarantees the cards. */
  guaranteed: boolean;
}

export interface Printing {
  set: SetInfo;
  rarity: string;
}

export interface Card {
  id: number;
  /** English name — the canonical one, always present. */
  name: string;
  /** German name where YGOPRODeck has one. */
  nameDe: string | null;
  type: string;
  /** Cardmarket price in euro cents; 0 when YGOPRODeck has no price. */
  priceCents: number;
  printings: Printing[];
  /** Fusion/Synchro/XYZ/Link monsters live in the Extra Deck. */
  extraDeck: boolean;
}

export interface Database {
  generated: string;
  sets: SetInfo[];
  cards: Card[];
  /** Every known passcode (main plus alt artwork) to its card. */
  byPasscode: Map<number, Card>;
  /** Normalized card name to its card, for text decklist parsing. */
  byName: Map<string, Card>;
}

/** One line of a decklist: a resolved card and how many copies it needs. */
export interface DeckEntry {
  card: Card;
  copies: number;
  section: DeckSection;
}

export type DeckSection = 'main' | 'extra' | 'side';

export interface Deck {
  entries: DeckEntry[];
  /** Lines or passcodes that could not be resolved, surfaced to the user. */
  unresolved: string[];
  source: DeckSourceFormat;
}

export type DeckSourceFormat = 'ydk' | 'ydke' | 'text';
