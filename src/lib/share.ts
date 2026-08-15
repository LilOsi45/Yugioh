/**
 * Decks live in the URL hash as a YDKE string, so a link carries the whole list
 * without a backend and without a database of saved decks.
 */

const HASH_KEY = 'deck';

export function readDeckFromHash(hash: string = globalThis.location?.hash ?? ''): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const deck = params.get(HASH_KEY);
  return deck && deck.trim() ? deck.trim() : null;
}

export function deckHash(ydke: string): string {
  return `#${HASH_KEY}=${encodeURIComponent(ydke)}`;
}

export function writeDeckToHash(ydke: string): void {
  const url = `${globalThis.location.pathname}${globalThis.location.search}${deckHash(ydke)}`;
  globalThis.history.replaceState(null, '', url);
}

export function clearDeckHash(): void {
  globalThis.history.replaceState(null, '', `${globalThis.location.pathname}${globalThis.location.search}`);
}

export function shareUrl(ydke: string): string {
  const { origin, pathname, search } = globalThis.location;
  return `${origin}${pathname}${search}${deckHash(ydke)}`;
}
