import type { Database, Deck } from '../types';
import { parseTextList } from './text';
import { looksLikeYdk, parseYdk } from './ydk';
import { looksLikeYdke, parseYdke, toYdke } from './ydke';

export { parseTextList, parseYdk, parseYdke, toYdke };

/**
 * One paste box for everything: a YDKE URL, the contents of a .ydk file, or a
 * decklist typed by hand. Guessing the format is more reliable than asking the user
 * to pick the right tab, and every branch degrades to the text parser.
 */
export function parseDeck(input: string, db: Database): Deck {
  const text = input.trim();
  if (looksLikeYdke(text)) return parseYdke(text, db);
  if (looksLikeYdk(text)) return parseYdk(text, db);
  return parseTextList(text, db);
}

/** Total copies in a deck, optionally restricted to one section. */
export function countCards(deck: Deck, section?: 'main' | 'extra' | 'side'): number {
  return deck.entries
    .filter((entry) => !section || entry.section === section)
    .reduce((sum, entry) => sum + entry.copies, 0);
}
