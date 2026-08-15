import { rankSets, type CardNeed, type CoverageOptions, type CoveredCard, type SetCoverage } from './setFinder';
import type { Availability, SetInfo } from './types';

export interface BuyStep {
  set: SetInfo;
  availability: Availability;
  /** Cards this step adds that no earlier step already covered. */
  newCards: CoveredCard[];
  newCopies: number;
  /** Cardmarket value of the copies this step covers, in euro cents. */
  newValueCents: number;
  /** Distinct deck cards covered after this step. */
  cumulativeCards: number;
}

export interface BuyPlan {
  steps: BuyStep[];
  /** Distinct cards the plan covers. */
  coveredCards: number;
  /** Distinct cards you still needed when the plan was built. */
  totalCards: number;
  /** What the covered copies would have cost as singles. */
  valueCents: number;
  /** Cards no purchasable product covers — buy these as singles. */
  remaining: CardNeed[];
}

export interface BuyPlanOptions extends CoverageOptions {
  /** Stop after this many purchases; the tail of a greedy plan is rarely worth it. */
  maxSteps?: number;
}

/**
 * "Which sets should I buy, in what order?"
 *
 * Greedy set cover: take the set covering the most of what you still need, strike
 * those cards off, repeat. Greedy is not optimal for set cover in general, but with
 * a 40 card deck and a handful of steps the difference is nil, and the output reads
 * as an actual shopping order instead of an unordered pile.
 *
 * Defaults to products with fixed contents. Including boosters would let the plan
 * claim a Secret Rare is "covered" when buying the set really buys a lottery ticket
 * — pass `guaranteedOnly: false` to opt into that reading.
 */
export function buildBuyPlan(needs: CardNeed[], options: BuyPlanOptions = {}): BuyPlan {
  const { maxSteps = 6, ...coverage } = options;
  const coverageOptions: CoverageOptions = { guaranteedOnly: true, ...coverage };

  let remaining = needs.filter((need) => need.needed > 0);
  const totalCards = remaining.length;
  const steps: BuyStep[] = [];
  let cumulativeCards = 0;
  let valueCents = 0;

  for (let step = 0; step < maxSteps && remaining.length > 0; step += 1) {
    const best: SetCoverage | undefined = rankSets(remaining, coverageOptions)[0];
    if (!best || best.distinctCards === 0) break;

    cumulativeCards += best.distinctCards;
    valueCents += best.valueCents;
    steps.push({
      set: best.set,
      availability: best.availability,
      newCards: best.cards,
      newCopies: best.copies,
      newValueCents: best.valueCents,
      cumulativeCards,
    });

    const covered = new Set(best.cards.map((entry) => entry.card.id));
    remaining = remaining.filter((need) => !covered.has(need.card.id));
  }

  return { steps, coveredCards: cumulativeCards, totalCards, valueCents, remaining };
}
