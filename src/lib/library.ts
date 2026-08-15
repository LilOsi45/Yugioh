import type { Card, Deck } from './types';
import type { CardNeed } from './setFinder';

/**
 * Decks the user keeps around, stored in the browser. The deck itself is held as a
 * YDKE string — the same format the importer already speaks — so a saved deck is
 * just a decklist and survives any change to the card index.
 */
export interface SavedDeck {
  id: string;
  name: string;
  ydke: string;
  savedAt: string;
}

const STORAGE_KEY = 'ygo-set-finder:library:v1';

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function newId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `deck-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export function parseLibrary(raw: string): SavedDeck[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  const decks: SavedDeck[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, name, ydke, savedAt } = entry as Record<string, unknown>;
    if (typeof id === 'string' && typeof name === 'string' && typeof ydke === 'string') {
      decks.push({ id, name, ydke, savedAt: typeof savedAt === 'string' ? savedAt : '' });
    }
  }
  return decks;
}

export function loadLibrary(): SavedDeck[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(STORAGE_KEY);
    return raw ? parseLibrary(raw) : [];
  } catch {
    return [];
  }
}

export function saveLibrary(decks: SavedDeck[]): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(decks));
  } catch {
    // A full or blocked localStorage must not break the app.
  }
}

/**
 * Adds a deck, or renames the existing entry when the exact same decklist is
 * already saved — saving the same deck twice from the same link is a mistake, not
 * an intent to keep two copies.
 */
export function addDeck(library: SavedDeck[], name: string, ydke: string, now = new Date()): SavedDeck[] {
  const trimmed = name.trim() || 'Unnamed deck';
  const existing = library.find((deck) => deck.ydke === ydke);
  if (existing) {
    return library.map((deck) => (deck.id === existing.id ? { ...deck, name: trimmed } : deck));
  }
  return [{ id: newId(), name: trimmed, ydke, savedAt: now.toISOString() }, ...library];
}

export function removeDeck(library: SavedDeck[], id: string): SavedDeck[] {
  return library.filter((deck) => deck.id !== id);
}

export function renameDeck(library: SavedDeck[], id: string, name: string): SavedDeck[] {
  const trimmed = name.trim();
  if (!trimmed) return library;
  return library.map((deck) => (deck.id === id ? { ...deck, name: trimmed } : deck));
}

export interface DeckProgress {
  /** Copies the deck asks for. */
  required: number;
  /** Copies the collection already covers. */
  owned: number;
  /** Distinct cards still missing at least one copy. */
  missingCards: number;
  /** 0–1, by copies rather than distinct cards. */
  ratio: number;
  complete: boolean;
}

/** How far a saved deck is from being buildable out of the collection. */
export function deckProgress(needs: CardNeed[]): DeckProgress {
  let required = 0;
  let owned = 0;
  let missingCards = 0;
  for (const need of needs) {
    required += need.required;
    owned += Math.min(need.owned, need.required);
    if (need.needed > 0) missingCards += 1;
  }
  return {
    required,
    owned,
    missingCards,
    ratio: required === 0 ? 1 : owned / required,
    complete: required > 0 && owned >= required,
  };
}

/** The next card to look for while building, most-missing first. */
export function stillMissing(needs: CardNeed[]): CardNeed[] {
  return needs.filter((need) => need.needed > 0).sort((a, b) => b.needed - a.needed);
}

export interface ScanOutcome {
  /** Shown back to the user so they know what the scan did. */
  message: string;
  /** New owned count to store, or null when the card is left alone. */
  owned: number | null;
}

/**
 * What happens when a card turns up while building a specific deck.
 *
 * Cards the deck does not ask for are ignored rather than swept into the
 * collection: working through a pile at a shop should not silently record every
 * card on the table. `keepOthers` opts into collecting them anyway.
 */
export function applyScannedCard(
  needs: CardNeed[],
  collection: ReadonlyMap<number, number>,
  card: Card,
  options: { keepOthers?: boolean } = {},
): ScanOutcome {
  const need = needs.find((entry) => entry.card.id === card.id);

  if (!need) {
    if (options.keepOthers) {
      const owned = (collection.get(card.id) ?? 0) + 1;
      return { message: `${card.name} — not in this deck, added to collection`, owned };
    }
    return { message: `${card.name} — not in this deck, ignored`, owned: null };
  }

  if (need.needed === 0) {
    return { message: `${card.name} — already have all ${need.required}`, owned: null };
  }

  const owned = need.owned + 1;
  return { message: `${card.name} ${owned}/${need.required} ✓`, owned };
}

/** A short, human name suggestion from a deck's most expensive cards. */
export function suggestDeckName(deck: Deck): string {
  const best: Card | undefined = deck.entries
    .filter((entry) => entry.section === 'main')
    .map((entry) => entry.card)
    .sort((a, b) => b.priceCents - a.priceCents)[0];
  return best ? `${best.name} deck` : 'New deck';
}
