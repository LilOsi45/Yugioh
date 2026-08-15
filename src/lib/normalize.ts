/**
 * Card names arrive from many places — YGOPRODeck, a pasted forum list, a Discord
 * message — with different apostrophes, dashes and spacing. Normalizing to bare
 * alphanumerics makes "Ash Blossom & Joyous Spring", "ash blossom joyous spring"
 * and "Ash Blossom &amp; Joyous Spring" all land on the same key.
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // combining accents left behind by NFKD
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/[^a-z0-9]/g, '');
}
