import { UNKNOWN_SET, type Collection } from './collection';
import type { Card, Database, SetInfo } from './types';

/**
 * What a collection adds up to, once it is big enough that scrolling it tells you
 * nothing.
 *
 * All of this is derived, never stored: the collection knows passcodes, counts and
 * printings, and the card index knows prices and set sizes. Keeping totals around
 * would only be one more thing to get out of step.
 */

export interface SetProgress {
  set: SetInfo;
  /** Distinct cards of that set held. */
  owned: number;
  /** Copies held, which can exceed the set size. */
  copies: number;
  valueCents: number;
  /** 0–1 of the set's distinct cards. */
  ratio: number;
}

/**
 * How far each set is from complete, fullest first.
 *
 * Only counts printings the scanner actually recorded — a card known to be owned but
 * with no set recorded says nothing about any particular set, and guessing would
 * make the numbers a fiction.
 */
export function setProgress(collection: Collection, db: Database): SetProgress[] {
  const byCode = new Map<string, { owned: number; copies: number; valueCents: number }>();

  for (const [id, holding] of collection) {
    const card = db.byPasscode.get(id);
    if (!card) continue;
    for (const [code, count] of holding.bySet) {
      if (code === UNKNOWN_SET || count <= 0) continue;
      const bucket = byCode.get(code) ?? { owned: 0, copies: 0, valueCents: 0 };
      bucket.owned += 1;
      bucket.copies += count;
      bucket.valueCents += card.priceCents * count;
      byCode.set(code, bucket);
    }
  }

  const sets = new Map(db.sets.map((set) => [set.code, set]));
  return [...byCode.entries()]
    .flatMap(([code, bucket]) => {
      const set = sets.get(code);
      if (!set) return [];
      return [{ set, ...bucket, ratio: set.numOfCards > 0 ? bucket.owned / set.numOfCards : 0 }];
    })
    .sort((a, b) => b.ratio - a.ratio || b.owned - a.owned);
}

export interface CardCount {
  card: Card;
  count: number;
  valueCents: number;
}

/**
 * Copies beyond a playset — the pile that can be traded or sold without touching
 * anything you would build with.
 *
 * Three is a playset, so duplicates start at the fourth copy. Sorted by what the
 * spare copies are worth, since that is the question being asked.
 */
export const PLAYSET = 3;

export function duplicates(collection: Collection, db: Database, playset = PLAYSET): CardCount[] {
  const out: CardCount[] = [];
  for (const [id, holding] of collection) {
    const spare = holding.total - playset;
    if (spare <= 0) continue;
    const card = db.byPasscode.get(id);
    if (card) out.push({ card, count: spare, valueCents: card.priceCents * spare });
  }
  return out.sort((a, b) => b.valueCents - a.valueCents || b.count - a.count);
}

export interface CollectionValue {
  cards: number;
  copies: number;
  totalCents: number;
  /** Most valuable holdings by total value, not unit price. */
  top: CardCount[];
}

export function collectionValue(collection: Collection, db: Database, topCount = 10): CollectionValue {
  let cards = 0;
  let copies = 0;
  let totalCents = 0;
  const all: CardCount[] = [];

  for (const [id, holding] of collection) {
    const card = db.byPasscode.get(id);
    if (!card) continue;
    const valueCents = card.priceCents * holding.total;
    cards += 1;
    copies += holding.total;
    totalCents += valueCents;
    if (valueCents > 0) all.push({ card, count: holding.total, valueCents });
  }

  all.sort((a, b) => b.valueCents - a.valueCents);
  return { cards, copies, totalCents, top: all.slice(0, topCount) };
}
