import type { Card } from './types';

/**
 * A link to the card on Cardmarket.
 *
 * The app cannot show what a *printing* is worth. Measured against the live data:
 * YGOPRODeck gives one Cardmarket price per card, and its per-printing `set_price`
 * field comes back as `0` for exactly the cards that matter — a card in RA03 at five
 * rarities reported zero for all five. Cardmarket itself has those prices, but has
 * no open interface, and a page with no server cannot ask it anyway.
 *
 * So instead of inventing a number, the app hands over: one tap and the real prices
 * for every rarity are on screen, on the marketplace the prices in this app come
 * from in the first place.
 *
 * A search link rather than a product link: product URLs contain Cardmarket's own
 * slug for the printing, which is not in our data, while the English card name is
 * exactly what their search expects.
 */
export function cardmarketUrl(card: Card): string {
  const query = new URLSearchParams({ searchString: card.name });
  return `https://www.cardmarket.com/de/YuGiOh/Products/Search?${query.toString()}`;
}
