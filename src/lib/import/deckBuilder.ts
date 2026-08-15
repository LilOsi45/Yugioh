import type { Card, Deck, DeckEntry, DeckSection, DeckSourceFormat } from '../types';

/**
 * Accumulates resolved cards into a deck, merging repeated copies. All three
 * importers feed into this so they agree on ordering and duplicate handling.
 */
export class DeckAccumulator {
  private readonly entries = new Map<string, DeckEntry>();
  private readonly unresolved: string[] = [];

  add(card: Card, section: DeckSection, copies = 1): void {
    const key = `${section}:${card.id}`;
    const existing = this.entries.get(key);
    if (existing) {
      existing.copies += copies;
      return;
    }
    this.entries.set(key, { card, copies, section });
  }

  /** Records an input we could not map to a card, so the UI can show it verbatim. */
  reject(line: string): void {
    const trimmed = line.trim();
    if (trimmed) this.unresolved.push(trimmed);
  }

  build(source: DeckSourceFormat): Deck {
    return { entries: [...this.entries.values()], unresolved: this.unresolved, source };
  }
}

/** Where a card belongs when the source format did not say. */
export function defaultSection(card: Card): DeckSection {
  return card.extraDeck ? 'extra' : 'main';
}
