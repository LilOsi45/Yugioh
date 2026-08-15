import type { Database, Deck } from './types';

/** Passcode to number of copies owned. Keyed by the card's main passcode. */
export type Collection = ReadonlyMap<number, number>;

const STORAGE_KEY = 'ygo-set-finder:collection:v1';

export const EMPTY_COLLECTION: Collection = new Map<number, number>();

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // private browsing, or a non-browser runtime
  }
}

export function loadCollection(): Collection {
  const store = storage();
  if (!store) return EMPTY_COLLECTION;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_COLLECTION;
    return parseCollection(raw);
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

export function serializeCollection(collection: Collection): string {
  return JSON.stringify(Object.fromEntries([...collection].map(([id, count]) => [String(id), count])));
}

export function parseCollection(raw: string): Collection {
  const parsed: unknown = JSON.parse(raw);
  const collection = new Map<number, number>();
  if (parsed && typeof parsed === 'object') {
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const id = Number.parseInt(key, 10);
      const count = typeof value === 'number' ? Math.floor(value) : Number.NaN;
      if (Number.isFinite(id) && Number.isFinite(count) && count > 0) collection.set(id, count);
    }
  }
  return collection;
}

/** Immutable update, so React state changes stay obvious. */
export function withOwned(collection: Collection, cardId: number, count: number): Collection {
  const next = new Map(collection);
  if (count > 0) next.set(cardId, Math.floor(count));
  else next.delete(cardId);
  return next;
}

/**
 * Turns a decklist into a collection, so you can dump a .ydk of what you own
 * instead of clicking through every card.
 */
export function collectionFromDeck(deck: Deck): Collection {
  const collection = new Map<number, number>();
  for (const entry of deck.entries) {
    collection.set(entry.card.id, (collection.get(entry.card.id) ?? 0) + entry.copies);
  }
  return collection;
}

export function mergeCollections(base: Collection, addition: Collection): Collection {
  const merged = new Map(base);
  for (const [id, count] of addition) merged.set(id, (merged.get(id) ?? 0) + count);
  return merged;
}

/** Drops passcodes the current card index no longer knows, so stale saves stay usable. */
export function pruneCollection(collection: Collection, db: Database): Collection {
  const pruned = new Map<number, number>();
  for (const [id, count] of collection) {
    if (db.byPasscode.has(id)) pruned.set(id, count);
  }
  return pruned;
}
