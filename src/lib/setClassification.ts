import type { Availability, ProductClass, SetInfo } from './types';

/**
 * YGOPRODeck tells us a set's name, code, size and release date — but not whether
 * buying it gets you the cards or merely a chance at them. That distinction is the
 * whole point of a buying plan, so we derive it from the set code prefix.
 *
 * The rules below cover the products people actually buy. They are heuristics: add
 * an entry to OVERRIDES when a specific set is misfiled rather than bending a rule
 * and breaking twenty other sets.
 */

/** Fixed contents: one purchase, cards in hand. */
const STRUCTURE_PREFIXES = ['SD', 'SR'];

/** Also fixed contents, but sold as decks/boxes rather than "Structure Deck". */
const BOXSET_PREFIXES = [
  'YS', // Starter Deck (Yugi, Kaiba, ...)
  'SS', // Speed Duel Starter Decks
  'SGX', // Speed Duel GX decks
  'SBC', // Speed Duel: Battle City Box
  'SBAD', // Speed Duel: Attack from the Deep
  'SBLS', // Speed Duel: Streets of Battle City
  'SBTK', // Speed Duel: Trials of the Kingdom
  'LDK', // Legendary Decks
  'YGLD', // Yugi's Legendary Decks
  'DLCS', // Dragons of Legend: The Complete Series (fixed-list box)
  'HAC', // Hidden Arsenal: Chapter (fixed-list box)
];

/** Mega Tins: sealed random packs plus a handful of fixed promos. */
const TIN_PREFIXES = ['MP'];

/** Promos you cannot simply order off a shelf. */
const PROMO_PREFIXES = [
  'CT', // Collectible Tin promo cards
  'OP', // OTS Tournament Pack
  'JMP', // Shonen Jump promo
  'JUMP',
  'MOV', // Movie promo
  'SJC', // Shonen Jump Championship
  'YCS', // Yu-Gi-Oh! Championship Series
  'WCPS', // World Championship prize cards
  'WCPP',
  'TKN', // Tokens
  'PRC', // Premium/Promo packs
];

/**
 * Exact-code corrections for sets the prefix rules get wrong. Keyed by set code
 * exactly as YGOPRODeck spells it. Empty for now — add entries here when you spot
 * a misfiled set instead of loosening a prefix rule.
 */
const OVERRIDES: Record<string, ProductClass> = {};

/** Set codes are like `LEDE`, `SR13`, `MP24`; we key rules off the leading letters. */
function letterPrefix(code: string): string {
  const match = /^[A-Z]+/.exec(code.toUpperCase());
  return match ? match[0] : '';
}

function matchesAny(code: string, prefixes: string[]): boolean {
  const upper = code.toUpperCase();
  return prefixes.some((prefix) => upper.startsWith(prefix));
}

export function classifyProduct(setCode: string, numOfCards: number): ProductClass {
  const code = setCode.toUpperCase().trim();
  if (!code) return 'unknown';

  const override = OVERRIDES[code];
  if (override) return override;

  // Longest-prefix families first so `SGX`/`SBC` win over the bare `S` families.
  if (matchesAny(code, BOXSET_PREFIXES)) return 'boxset';
  if (matchesAny(code, STRUCTURE_PREFIXES)) return 'structure';
  if (matchesAny(code, TIN_PREFIXES)) return 'tin';
  if (matchesAny(code, PROMO_PREFIXES)) return 'promo';

  // A four-letter code with a booster-sized card list is the modern core set shape.
  if (letterPrefix(code).length >= 2 && numOfCards >= 40) return 'booster';
  if (numOfCards > 0 && numOfCards < 40) return 'promo';
  return 'unknown';
}

/** True when buying one copy of the product hands you its cards outright. */
export function isGuaranteed(product: ProductClass): boolean {
  return product === 'structure' || product === 'boxset';
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function classifyAvailability(tcgDate: string | null, now: Date = new Date()): Availability {
  if (!tcgDate) return 'unknown';
  const released = Date.parse(tcgDate);
  if (Number.isNaN(released)) return 'unknown';

  const ageDays = (now.getTime() - released) / DAY_MS;
  if (ageDays < 0) return 'upcoming';
  if (ageDays <= 550) return 'current'; // roughly 18 months
  if (ageDays <= 1460) return 'aging'; // roughly 4 years
  return 'out-of-print';
}

/** Days until release; negative once released, null when the date is unknown. */
export function daysUntilRelease(tcgDate: string | null, now: Date = new Date()): number | null {
  if (!tcgDate) return null;
  const released = Date.parse(tcgDate);
  if (Number.isNaN(released)) return null;
  return Math.ceil((released - now.getTime()) / DAY_MS);
}

export const PRODUCT_LABELS: Record<ProductClass, string> = {
  structure: 'Structure Deck',
  boxset: 'Box / Deck',
  tin: 'Tin (sealed packs)',
  booster: 'Booster (random pull)',
  promo: 'Promo',
  unknown: 'Unknown product',
};

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  upcoming: 'Not released yet',
  current: 'In print',
  aging: 'Getting scarce',
  'out-of-print': 'Out of print',
  unknown: 'Unknown',
};

export function describeSet(set: SetInfo): string {
  return `${set.name} (${set.code}) — ${PRODUCT_LABELS[set.product]}`;
}
