import { classifyAvailability } from './setClassification';
import type { Availability, Card, Deck, SetInfo } from './types';

/** A card you still have to acquire, and how many copies of it. */
export interface CardNeed {
  card: Card;
  needed: number;
  /** Copies the deck asks for, before subtracting what you own. */
  required: number;
  owned: number;
}

export interface CoveredCard {
  card: Card;
  needed: number;
  /** Every rarity this set prints the card at — the same card is often in twice. */
  rarities: string[];
}

export interface SetCoverage {
  set: SetInfo;
  availability: Availability;
  cards: CoveredCard[];
  /** Distinct deck cards this set can supply. The headline number. */
  distinctCards: number;
  /** Total copies covered, counting playsets. */
  copies: number;
  /** Cardmarket value of the copies covered, in euro cents. */
  valueCents: number;
}

export interface CoverageOptions {
  now?: Date;
  /** Only products with fixed contents, where buying really does get you the card. */
  guaranteedOnly?: boolean;
  /** Sets that have not been released yet are hidden by default. */
  includeUnreleased?: boolean;
  /** Sets nobody stocks any more are noise when you are shopping. */
  includeOutOfPrint?: boolean;
  /** Drop sets covering fewer than this many distinct cards. */
  minCards?: number;
}

/**
 * Collapses a deck into "what do I still have to buy", merging a card that appears
 * in both the main deck and the side deck and subtracting what the collection says
 * you already own.
 */
export function deckNeeds(
  deck: Deck,
  owned: ReadonlyMap<number, number> = new Map(),
  options: { includeSide?: boolean } = {},
): CardNeed[] {
  const includeSide = options.includeSide ?? true;
  const required = new Map<number, { card: Card; copies: number }>();

  for (const entry of deck.entries) {
    if (entry.section === 'side' && !includeSide) continue;
    const existing = required.get(entry.card.id);
    if (existing) {
      existing.copies += entry.copies;
    } else {
      required.set(entry.card.id, { card: entry.card, copies: entry.copies });
    }
  }

  const needs: CardNeed[] = [];
  for (const { card, copies } of required.values()) {
    const have = owned.get(card.id) ?? 0;
    needs.push({ card, required: copies, owned: have, needed: Math.max(0, copies - have) });
  }
  return needs.sort((a, b) => b.card.priceCents - a.card.priceCents || a.card.name.localeCompare(b.card.name));
}

function keepSet(set: SetInfo, availability: Availability, options: CoverageOptions): boolean {
  if (options.guaranteedOnly && !set.guaranteed) return false;
  if (availability === 'upcoming' && !options.includeUnreleased) return false;
  if (availability === 'out-of-print' && options.includeOutOfPrint === false) return false;
  return true;
}

/**
 * The core question: for every set, which of the cards I still need does it print?
 *
 * Ranked by distinct cards covered, because that is what makes a purchase worth
 * making. Copies and cardmarket value break ties, then a guaranteed product beats a
 * booster and a newer set beats an older one — both proxies for "can I actually buy
 * this right now".
 */
export function rankSets(needs: CardNeed[], options: CoverageOptions = {}): SetCoverage[] {
  const now = options.now ?? new Date();
  const outstanding = needs.filter((need) => need.needed > 0);
  const bySet = new Map<number, SetCoverage>();

  for (const need of outstanding) {
    // A card printed twice in one set (Common plus Secret) must not count twice.
    const perSet = new Map<number, string[]>();
    for (const printing of need.card.printings) {
      const rarities = perSet.get(printing.set.index);
      if (rarities) {
        if (!rarities.includes(printing.rarity)) rarities.push(printing.rarity);
      } else {
        perSet.set(printing.set.index, [printing.rarity]);
      }
    }

    for (const [setIndex, rarities] of perSet) {
      const set = need.card.printings.find((printing) => printing.set.index === setIndex)!.set;
      const availability = classifyAvailability(set.tcgDate, now);
      if (!keepSet(set, availability, options)) continue;

      let coverage = bySet.get(setIndex);
      if (!coverage) {
        coverage = { set, availability, cards: [], distinctCards: 0, copies: 0, valueCents: 0 };
        bySet.set(setIndex, coverage);
      }
      coverage.cards.push({ card: need.card, needed: need.needed, rarities });
      coverage.distinctCards += 1;
      coverage.copies += need.needed;
      coverage.valueCents += need.needed * need.card.priceCents;
    }
  }

  const minCards = options.minCards ?? 1;
  const ranked = [...bySet.values()].filter((coverage) => coverage.distinctCards >= minCards);

  for (const coverage of ranked) {
    coverage.cards.sort((a, b) => b.card.priceCents - a.card.priceCents || a.card.name.localeCompare(b.card.name));
  }

  return ranked.sort(compareCoverage);
}

function compareCoverage(a: SetCoverage, b: SetCoverage): number {
  return (
    b.distinctCards - a.distinctCards ||
    b.copies - a.copies ||
    b.valueCents - a.valueCents ||
    Number(b.set.guaranteed) - Number(a.set.guaranteed) ||
    (b.set.tcgDate ?? '').localeCompare(a.set.tcgDate ?? '') ||
    a.set.name.localeCompare(b.set.name)
  );
}
