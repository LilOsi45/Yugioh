import type { Database, Deck } from './types';

/**
 * What you own of one card: how many in total, and how many of each printing.
 *
 * The set breakdown exists because a card lives in many sets — Ash Blossom is in
 * PHNI, OP27 and RS26 — and "sort my binder by set" is only answerable if we record
 * which printing a copy actually is. The scanner reads the set code off the card, so
 * it costs the user nothing; anything entered by hand lands in UNKNOWN_SET.
 */
export interface CardHolding {
  total: number;
  /** Copies per set code. `UNKNOWN_SET` holds copies whose printing is unrecorded. */
  bySet: ReadonlyMap<string, number>;
}

export type Collection = ReadonlyMap<number, CardHolding>;

/** Bucket for copies whose printing we do not know. */
export const UNKNOWN_SET = '';

const STORAGE_KEY = 'ygo-set-finder:collection:v2';
/** Read once for migration; copies land in the unknown-set bucket. */
const LEGACY_KEY = 'ygo-set-finder:collection:v1';

export const EMPTY_COLLECTION: Collection = new Map<number, CardHolding>();

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // private browsing, or a non-browser runtime
  }
}

export function ownedCount(collection: Collection, cardId: number): number {
  return collection.get(cardId)?.total ?? 0;
}

/**
 * Plain passcode-to-count view. The deck maths only ever needs totals, so it keeps
 * working on a simple map and stays unaware of the set breakdown.
 */
export function collectionTotals(collection: Collection): ReadonlyMap<number, number> {
  const totals = new Map<number, number>();
  for (const [id, holding] of collection) totals.set(id, holding.total);
  return totals;
}

function holdingFrom(bySet: Map<string, number>): CardHolding {
  let total = 0;
  for (const count of bySet.values()) total += count;
  return { total, bySet };
}

/** Adds copies of one printing. `delta` may be negative, for undo. */
export function addCopies(
  collection: Collection,
  cardId: number,
  setCode: string = UNKNOWN_SET,
  delta = 1,
): Collection {
  const next = new Map(collection);
  const bySet = new Map(collection.get(cardId)?.bySet ?? []);
  const updated = (bySet.get(setCode) ?? 0) + delta;

  if (updated > 0) bySet.set(setCode, updated);
  else bySet.delete(setCode);

  const holding = holdingFrom(bySet);
  if (holding.total > 0) next.set(cardId, holding);
  else next.delete(cardId);
  return next;
}

/**
 * Sets the total directly, for the number input next to a card.
 *
 * Growing adds to the unknown bucket, since a typed number says nothing about which
 * printing. Shrinking empties the unknown bucket first and only then trims recorded
 * printings, largest first, so hard-won set information is the last thing lost.
 */
export function setOwnedTotal(collection: Collection, cardId: number, total: number): Collection {
  const wanted = Math.max(0, Math.floor(total));
  const next = new Map(collection);
  if (wanted === 0) {
    next.delete(cardId);
    return next;
  }

  const bySet = new Map(collection.get(cardId)?.bySet ?? []);
  const known = [...bySet].filter(([code]) => code !== UNKNOWN_SET).reduce((sum, [, n]) => sum + n, 0);

  if (wanted >= known) {
    const remainder = wanted - known;
    if (remainder > 0) bySet.set(UNKNOWN_SET, remainder);
    else bySet.delete(UNKNOWN_SET);
  } else {
    bySet.delete(UNKNOWN_SET);
    let excess = known - wanted;
    const codes = [...bySet.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    for (const [code, count] of codes) {
      if (excess <= 0) break;
      const take = Math.min(count, excess);
      excess -= take;
      if (count - take > 0) bySet.set(code, count - take);
      else bySet.delete(code);
    }
  }

  next.set(cardId, holdingFrom(bySet));
  return next;
}

export function serializeCollection(collection: Collection): string {
  const plain: Record<string, Record<string, number>> = {};
  for (const [id, holding] of collection) plain[String(id)] = Object.fromEntries(holding.bySet);
  return JSON.stringify(plain);
}

/**
 * Reads both shapes: the current `{passcode: {SET: count}}` and the original
 * `{passcode: count}`, whose copies become unknown-set entries.
 */
export function parseCollection(raw: string): Collection {
  const parsed: unknown = JSON.parse(raw);
  const collection = new Map<number, CardHolding>();
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return collection;

  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const id = Number.parseInt(key, 10);
    if (!Number.isFinite(id)) continue;

    const bySet = new Map<string, number>();
    if (typeof value === 'number') {
      const count = Math.floor(value);
      if (count > 0) bySet.set(UNKNOWN_SET, count);
    } else if (value && typeof value === 'object') {
      for (const [code, amount] of Object.entries(value as Record<string, unknown>)) {
        const count = typeof amount === 'number' ? Math.floor(amount) : Number.NaN;
        if (Number.isFinite(count) && count > 0) bySet.set(code, count);
      }
    }

    const holding = holdingFrom(bySet);
    if (holding.total > 0) collection.set(id, holding);
  }
  return collection;
}

export function loadCollection(): Collection {
  const store = storage();
  if (!store) return EMPTY_COLLECTION;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (raw) return parseCollection(raw);
    // First run after the upgrade: adopt whatever the old format held.
    const legacy = store.getItem(LEGACY_KEY);
    return legacy ? parseCollection(legacy) : EMPTY_COLLECTION;
  } catch {
    return EMPTY_COLLECTION;
  }
}

export function saveCollection(collection: Collection): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, serializeCollection(collection));
  } catch {
    // A full or blocked localStorage should never break the app.
  }
}

/**
 * Turns a decklist into a collection, so you can dump a .ydk of what you own
 * instead of clicking through every card. A .ydk carries no set information.
 */
export function collectionFromDeck(deck: Deck): Collection {
  let collection: Collection = EMPTY_COLLECTION;
  for (const entry of deck.entries) {
    collection = addCopies(collection, entry.card.id, UNKNOWN_SET, entry.copies);
  }
  return collection;
}

export function mergeCollections(base: Collection, addition: Collection): Collection {
  let merged = base;
  for (const [id, holding] of addition) {
    for (const [code, count] of holding.bySet) merged = addCopies(merged, id, code, count);
  }
  return merged;
}

/** Drops passcodes the current card index no longer knows, so stale saves stay usable. */
export function pruneCollection(collection: Collection, db: Database): Collection {
  const pruned = new Map<number, CardHolding>();
  for (const [id, holding] of collection) {
    if (db.byPasscode.has(id)) pruned.set(id, holding);
  }
  return pruned;
}
