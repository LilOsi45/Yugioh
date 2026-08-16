import { parseDeck } from './import';
import type { SavedDeck } from './library';
import { deckNeeds, type CardNeed } from './setFinder';
import type { Database } from './types';

/**
 * Everything still missing across *all* saved decks, as one shopping list.
 *
 * The point is the merge rule: three decks each asking for three Ash Blossom do not
 * need nine, because the same three cards move between decks. So the requirement per
 * card is the **largest** any single deck asks for, not the sum. Getting this wrong
 * would inflate a shopping list far past what anyone actually needs to buy.
 *
 * Side decks are left out, in line with what the per-deck view counts by default.
 */
export function combinedNeeds(
  library: SavedDeck[],
  db: Database,
  owned: ReadonlyMap<number, number>,
): CardNeed[] {
  const required = new Map<number, CardNeed>();

  for (const saved of library) {
    // Needs are computed against an empty collection first, so `required` is the
    // deck's own demand; ownership is subtracted once at the end.
    for (const need of deckNeeds(parseDeck(saved.ydke, db), new Map())) {
      const existing = required.get(need.card.id);
      if (!existing || need.required > existing.required) {
        required.set(need.card.id, { ...need });
      }
    }
  }

  return [...required.values()]
    .map((need) => {
      const have = owned.get(need.card.id) ?? 0;
      return { ...need, owned: have, needed: Math.max(0, need.required - have) };
    })
    .sort(
      (a, b) =>
        b.needed * b.card.priceCents - a.needed * a.card.priceCents ||
        b.needed - a.needed ||
        a.card.name.localeCompare(b.card.name),
    );
}
