import { displayName } from './dataset';
import { normalizeName } from './normalize';
import { parseHoldingKey, UNKNOWN_SET } from './collection';
import type { Card, Database } from './types';

export interface CollectionEntry {
  card: Card;
  count: number;
  /** Copies per printing key (`SET` or `SET|Rarity`), once one has been recorded. */
  bySet?: ReadonlyMap<string, number>;
  /** Set when the row stands for one printing, as the set grouping produces. */
  rarity?: string | null;
  /** `DE`, `EN`, … — which language this copy is printed in, when it was recorded. */
  language?: string | null;
}

export type CollectionSort = 'set' | 'type' | 'name' | 'price' | 'count';

/** The groups players actually think in when tidying a collection. */
export type CardCategory = 'monster' | 'extra' | 'spell' | 'trap';

export const CATEGORY_LABELS: Record<CardCategory, string> = {
  monster: 'Monster',
  extra: 'Extra Deck',
  spell: 'Spells',
  trap: 'Traps',
};

/** Fixed display order, so the collection always reads the same way. */
const CATEGORY_ORDER: CardCategory[] = ['monster', 'extra', 'spell', 'trap'];

export const SORT_LABELS: Record<CollectionSort, string> = {
  set: 'Set',
  type: 'Typ',
  name: 'Name',
  price: 'Preis',
  count: 'Anzahl',
};

export function cardCategory(card: Card): CardCategory {
  // Extra deck monsters are checked first: they are monsters too, but they live in
  // a different pile.
  if (card.extraDeck) return 'extra';
  const type = card.type.toLowerCase();
  if (type.includes('spell')) return 'spell';
  if (type.includes('trap')) return 'trap';
  return 'monster';
}

function byName(a: CollectionEntry, b: CollectionEntry): number {
  return displayName(a.card).localeCompare(displayName(b.card), 'de');
}

export function sortEntries(entries: CollectionEntry[], sort: CollectionSort): CollectionEntry[] {
  const sorted = [...entries];
  switch (sort) {
    case 'name':
      return sorted.sort(byName);
    case 'price':
      // By total value, since ten cheap copies can outweigh one pricier card.
      return sorted.sort((a, b) => b.card.priceCents * b.count - a.card.priceCents * a.count || byName(a, b));
    case 'count':
      return sorted.sort((a, b) => b.count - a.count || byName(a, b));
    case 'set':
      // Ordering within a set group; the grouping itself does the real work.
      return sorted.sort(byName);
    case 'type':
      return sorted.sort(
        (a, b) =>
          CATEGORY_ORDER.indexOf(cardCategory(a.card)) - CATEGORY_ORDER.indexOf(cardCategory(b.card)) ||
          byName(a, b),
      );
    default:
      return sorted;
  }
}

export interface CategoryGroup {
  category: CardCategory;
  entries: CollectionEntry[];
}

/** Splits sorted entries into labelled sections, keeping the given order. */
export function groupByCategory(entries: CollectionEntry[]): CategoryGroup[] {
  const groups = new Map<CardCategory, CollectionEntry[]>();
  for (const entry of entries) {
    const category = cardCategory(entry.card);
    const bucket = groups.get(category);
    if (bucket) bucket.push(entry);
    else groups.set(category, [entry]);
  }
  return CATEGORY_ORDER.filter((category) => groups.has(category)).map((category) => ({
    category,
    entries: groups.get(category)!,
  }));
}

export interface SetGroup {
  /** Set code, or UNKNOWN_SET for copies whose printing was never recorded. */
  code: string;
  name: string;
  entries: CollectionEntry[];
}

/**
 * Splits the collection by printing, the way a binder sorted by set looks.
 *
 * A card held in two sets appears in both groups with the count for that set —
 * three Ash Blossom, two from PHNI and one from OP27, is genuinely three cards in
 * two places, and showing it once would hide half the information.
 */
export function groupBySet(entries: CollectionEntry[], db: Database): SetGroup[] {
  const groups = new Map<string, CollectionEntry[]>();

  for (const entry of entries) {
    // No recorded printing at all: everything falls into the unknown bucket.
    const bySet = entry.bySet && entry.bySet.size > 0 ? entry.bySet : new Map([[UNKNOWN_SET, entry.count]]);
    for (const [key, count] of bySet) {
      if (count <= 0) continue;
      // Keys carry the rarity too; the group is the set, the rarity rides on the row.
      const { setCode, rarity, language } = parseHoldingKey(key);
      const bucket = groups.get(setCode);
      const scoped: CollectionEntry = { card: entry.card, count, rarity, language };
      if (bucket) bucket.push(scoped);
      else groups.set(setCode, [scoped]);
    }
  }

  const nameByCode = new Map(db.sets.map((set) => [set.code, set.name]));
  return [...groups.entries()]
    .map(([code, list]) => ({
      code,
      name: code === UNKNOWN_SET ? 'Ohne Set' : (nameByCode.get(code) ?? code),
      entries: list.sort((a, b) => byName(a, b) || (a.rarity ?? '').localeCompare(b.rarity ?? '')),
    }))
    // Unknown last: it is a to-do pile, not a set.
    .sort((a, b) =>
      a.code === UNKNOWN_SET ? 1 : b.code === UNKNOWN_SET ? -1 : a.code.localeCompare(b.code),
    );
}

/** Matches against both names, so either language finds the card. */
export function filterEntries(entries: CollectionEntry[], query: string): CollectionEntry[] {
  const needle = normalizeName(query);
  if (!needle) return entries;
  return entries.filter((entry) => {
    const german = entry.card.nameDe ? normalizeName(entry.card.nameDe) : '';
    return normalizeName(entry.card.name).includes(needle) || german.includes(needle);
  });
}

export interface CollectionFilter {
  /** Only cards held beyond a playset — the pile that can be traded away. */
  doublesOnly?: boolean;
  /** Only cards with no printing recorded — the ones still to be sorted out. */
  withoutSet?: boolean;
  category?: CardCategory | null;
  /** Only cards held in this set, in any rarity. */
  setCode?: string | null;
}

/** Copies beyond this many are spares; matches the doubles list in the stats. */
const PLAYSET = 3;

/**
 * Narrows the collection by the questions actually asked of it: what can I trade,
 * what still needs sorting, what is in this set, what type is it. Separate from the
 * text search so both can apply at once.
 */
export function applyFilter(entries: CollectionEntry[], filter: CollectionFilter): CollectionEntry[] {
  const { doublesOnly, withoutSet, category, setCode } = filter;
  if (!doublesOnly && !withoutSet && !category && !setCode) return entries;

  return entries.filter((entry) => {
    if (doublesOnly && entry.count <= PLAYSET) return false;
    if (category && cardCategory(entry.card) !== category) return false;

    if (withoutSet || setCode) {
      const keys = [...(entry.bySet?.keys() ?? [])];
      const codes = keys.map((key) => parseHoldingKey(key).setCode);
      // No breakdown at all counts as "no set recorded" — that is what it means.
      const unrecorded = codes.length === 0 || codes.some((code) => code === UNKNOWN_SET);
      if (withoutSet && !unrecorded) return false;
      if (setCode && !codes.includes(setCode)) return false;
    }
    return true;
  });
}

/** Set codes present in the collection, for the picker, most copies first. */
export function setsInCollection(entries: CollectionEntry[]): string[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const [key, count] of entry.bySet ?? []) {
      const { setCode } = parseHoldingKey(key);
      if (setCode === UNKNOWN_SET) continue;
      counts.set(setCode, (counts.get(setCode) ?? 0) + count);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([code]) => code);
}
