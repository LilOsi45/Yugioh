import { classifyAvailability, daysUntilRelease } from './setClassification';
import type { CardNeed } from './setFinder';
import type { Card, Printing } from './types';

export interface ReprintNews {
  card: Card;
  needed: number;
  printing: Printing;
  /** Negative once the set is out; null when the set has no date. */
  daysUntil: number;
  releaseDate: string;
}

/** Cheap cards are not worth waiting for; this is where "wait" starts to pay. */
export const WAIT_PRICE_CENTS = 300;
/** A reprint further out than this is not a reason to postpone a purchase. */
export const WAIT_WINDOW_DAYS = 200;
/** How long after release a reprint still explains a falling price. */
export const RECENT_WINDOW_DAYS = 120;

function newsFor(need: CardNeed, printing: Printing, now: Date): ReprintNews | null {
  const daysUntil = daysUntilRelease(printing.set.tcgDate, now);
  if (daysUntil === null || !printing.set.tcgDate) return null;
  return { card: need.card, needed: need.needed, printing, daysUntil, releaseDate: printing.set.tcgDate };
}

/**
 * Announced sets show up in YGOPRODeck with a release date in the future, so a
 * printing dated later than today *is* the upcoming reprint. That is the whole
 * trick behind this panel — no second site to check.
 */
export function upcomingReprints(needs: CardNeed[], now: Date = new Date()): ReprintNews[] {
  const news: ReprintNews[] = [];
  for (const need of needs) {
    if (need.needed <= 0) continue;
    for (const printing of need.card.printings) {
      if (classifyAvailability(printing.set.tcgDate, now) !== 'upcoming') continue;
      const item = newsFor(need, printing, now);
      if (item) news.push(item);
    }
  }
  return news.sort((a, b) => a.daysUntil - b.daysUntil || b.card.priceCents - a.card.priceCents);
}

/** Sets released just now, which usually means the single is still settling downwards. */
export function recentReprints(needs: CardNeed[], now: Date = new Date(), withinDays = RECENT_WINDOW_DAYS): ReprintNews[] {
  const news: ReprintNews[] = [];
  for (const need of needs) {
    if (need.needed <= 0) continue;
    for (const printing of need.card.printings) {
      const item = newsFor(need, printing, now);
      if (!item) continue;
      if (item.daysUntil <= 0 && item.daysUntil >= -withinDays) news.push(item);
    }
  }
  return news.sort((a, b) => b.daysUntil - a.daysUntil || b.card.priceCents - a.card.priceCents);
}

/**
 * Cards worth holding off on: expensive enough to matter, with a reprint close
 * enough to actually wait for.
 */
export function waitWarnings(needs: CardNeed[], now: Date = new Date()): ReprintNews[] {
  const seen = new Set<number>();
  return upcomingReprints(needs, now).filter((news) => {
    if (news.card.priceCents < WAIT_PRICE_CENTS) return false;
    if (news.daysUntil > WAIT_WINDOW_DAYS) return false;
    if (seen.has(news.card.id)) return false; // one warning per card, the earliest one
    seen.add(news.card.id);
    return true;
  });
}

export function formatDaysUntil(days: number): string {
  if (days <= 0) return 'released';
  if (days === 1) return 'tomorrow';
  if (days < 31) return `in ${days} days`;
  const months = Math.round(days / 30);
  return months <= 1 ? 'in about a month' : `in about ${months} months`;
}
