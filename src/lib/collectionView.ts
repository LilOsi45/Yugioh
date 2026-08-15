import { displayName } from './dataset';
import { normalizeName } from './normalize';
import { UNKNOWN_SET } from './collection';
import type { Card, Database } from './types';

export interface CollectionEntry {
  card: Card;
  count: number;
  /** Copies per set code, present once a printing has been recorded. */
  bySet?: ReadonlyMap<string, number>;
}

export type CollectionSort = 'set' | 'type' | 'name' | 'price' | 'count';

/** The groups players actually think in when tidying a collection. */
export type CardCategory = 'monster' | 'extra' | 'spell' | 'trap';

export const CATEGORY_LABELS: Record<CardCategory, string> = {
  monster: 'Monster',
  extra: 'Extra Deck',
  spell: 'Zauber',
  trap: 'Fallen',
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
    for (const [code, count] of bySet) {
      if (count <= 0) continue;
      const bucket = groups.get(code);
      const scoped: CollectionEntry = { card: entry.card, count };
      if (bucket) bucket.push(scoped);
      else groups.set(code, [scoped]);
    }
  }

  const nameByCode = new Map(db.sets.map((set) => [set.code, set.name]));
  return [...groups.entries()]
    .map(([code, list]) => ({
      code,
      name: code === UNKNOWN_SET ? 'Ohne Set' : (nameByCode.get(code) ?? code),
      entries: list.sort(byName),
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
