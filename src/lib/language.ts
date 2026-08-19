/**
 * Tells a German printing from an English one by reading the card's name.
 *
 * The language is printed in the set code — `MAGO-DE009` — and that is where it is
 * taken from when the code can be read. Live from a phone's preview the code usually
 * cannot: it is set at about a third the height of the passcode. Measured on the
 * device, the set line comes back as `ERTDIF4ADANICHERRENBS - T A A TL K`.
 *
 * The name is the other place the language is written, and it is written large. What
 * makes it workable is that this is not recognition but *comparison*: the card is
 * already known by then, and the index carries both its English and its German name.
 * Two known strings to choose between, the same shape of problem as the set code —
 * look for what you expect rather than parse what you find.
 *
 * Names are foil, stylised, and read badly. So the comparison is on shared character
 * pairs rather than on getting the letters right, and it refuses to answer unless one
 * name is clearly closer than the other.
 */

/**
 * Strips a name to what survives being printed in gold on a foil background and read
 * by a camera: letters only, one case, umlauts folded to their base letter.
 *
 * Folding the umlauts costs a little of the German signal and buys much more back —
 * OCR reads `ö` as `o`, `Ö`, `6` or nothing at all depending on the light, and a
 * comparison that leaned on them would swing with the angle of the card.
 */
export function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replaceAll('Ä', 'A')
    .replaceAll('Ö', 'O')
    .replaceAll('Ü', 'U')
    .replaceAll('ß', 'SS')
    .replace(/[^A-Z]/g, '');
}

/** The character pairs of a string, which is what the similarity is measured on. */
function bigrams(text: string): string[] {
  const pairs: string[] = [];
  for (let i = 0; i < text.length - 1; i += 1) pairs.push(text.slice(i, i + 2));
  return pairs;
}

/**
 * How alike two names are, from 0 to 1, counting shared character pairs.
 *
 * Pairs rather than single letters because letter counts alone are too easy to satisfy
 * by accident — `DRAGON` and `NOGARD` hold the same six letters and share no pair.
 * Pairs are not word order: `SEA DRAGON` and `DRAGON SEA` still score high, which is
 * fine here, because the two things being told apart are a German name and an English
 * one and those are not each other's anagrams.
 */
export function similarity(a: string, b: string): number {
  const left = bigrams(normalizeName(a));
  const right = bigrams(normalizeName(b));
  if (left.length === 0 || right.length === 0) return normalizeName(a) === normalizeName(b) ? 1 : 0;

  const pool = new Map<string, number>();
  for (const pair of left) pool.set(pair, (pool.get(pair) ?? 0) + 1);
  let shared = 0;
  for (const pair of right) {
    const left = pool.get(pair) ?? 0;
    if (left > 0) {
      shared += 1;
      pool.set(pair, left - 1);
    }
  }
  return (2 * shared) / (left.length + right.length);
}

/** How close the reading has to come to a name before it counts as that name at all. */
export const MIN_SIMILARITY = 0.4;
/** And how far ahead of the other name, so a near tie is left undecided. */
export const MIN_MARGIN = 0.15;

export interface LanguageGuess {
  language: 'DE' | 'EN' | null;
  german: number;
  english: number;
}

/**
 * Which language the name in `reading` is, given the card's two names.
 *
 * Answers `null` far more readily than it answers wrong. Three ways to get nothing,
 * all of them right: the card has no German name; both names are the same word, which
 * is common for cards never translated; or the reading is no closer to one than the
 * other, which is what a bad look at a foil name produces.
 */
export function guessLanguage(
  reading: string,
  english: string,
  german: string | null,
): LanguageGuess {
  const none = { language: null, german: 0, english: 0 } as const;
  if (!german) return none;
  // Untranslated cards carry the English name in both fields, so nothing separates
  // the two printings by name — the set code is the only way to tell those apart.
  if (normalizeName(german) === normalizeName(english)) return none;

  const scores = { german: similarity(reading, german), english: similarity(reading, english) };
  const best = Math.max(scores.german, scores.english);
  if (best < MIN_SIMILARITY) return { ...scores, language: null };
  if (Math.abs(scores.german - scores.english) < MIN_MARGIN) return { ...scores, language: null };
  return { ...scores, language: scores.german > scores.english ? 'DE' : 'EN' };
}
