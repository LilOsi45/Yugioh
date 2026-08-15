import type { CardNeed } from './setFinder';
import type { Card } from './types';

export interface DeckBudget {
  /** Every copy the deck asks for, at cardmarket prices. */
  fullDeckCents: number;
  /** Only the copies you still have to buy. */
  missingCents: number;
  /** Value of what the collection already covers. */
  ownedCents: number;
  /** Cards YGOPRODeck has no cardmarket price for — the totals exclude them. */
  unpriced: Card[];
  /** Most expensive outstanding cards first; where a budget actually goes. */
  biggestItems: CardNeed[];
}

/**
 * YGOPRODeck ships one cardmarket price per card, which tracks the cheapest
 * available printing rather than any specific rarity. That is the right number for
 * "what does this deck cost me", and it is why the app does not pretend to price
 * individual printings.
 */
export function deckBudget(needs: CardNeed[], topItems = 10): DeckBudget {
  let fullDeckCents = 0;
  let missingCents = 0;
  let ownedCents = 0;
  const unpriced: Card[] = [];

  for (const need of needs) {
    const price = need.card.priceCents;
    if (price === 0) {
      unpriced.push(need.card);
      continue;
    }
    fullDeckCents += price * need.required;
    missingCents += price * need.needed;
    ownedCents += price * Math.min(need.owned, need.required);
  }

  const biggestItems = needs
    .filter((need) => need.needed > 0 && need.card.priceCents > 0)
    .sort((a, b) => b.card.priceCents * b.needed - a.card.priceCents * a.needed)
    .slice(0, topItems);

  return { fullDeckCents, missingCents, ownedCents, unpriced, biggestItems };
}

const EURO = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

export function formatEuro(cents: number): string {
  return EURO.format(cents / 100);
}
