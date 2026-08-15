import type { Card } from './types';

/**
 * Card artwork comes from YGOPRODeck's image server.
 *
 * Their API guide asks that images be downloaded and self-hosted rather than
 * hotlinked. Self-hosting is not workable here — 14,000-odd cards is several
 * hundred megabytes per deploy — so we keep the load as small as we can instead:
 * the `cards_small` variant (roughly 15 KB rather than 100 KB), and `loading="lazy"`
 * so a device only ever fetches the tiles it actually scrolls to. Viewing one deck
 * costs about sixty images, not fourteen thousand, and the browser caches them.
 */
const IMAGE_BASE = 'https://images.ygoprodeck.com/images/cards_small';

export function cardImageUrl(card: Card): string {
  return `${IMAGE_BASE}/${card.id}.jpg`;
}

/** Yu-Gi-Oh! cards are 59mm x 86mm; tiles keep that shape so the grid stays even. */
export const CARD_ASPECT = '59 / 86';
