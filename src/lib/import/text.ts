import { normalizeName } from '../normalize';
import type { Card, Database, Deck, DeckSection } from '../types';
import { DeckAccumulator, defaultSection } from './deckBuilder';

/**
 * Free-form decklists as people actually paste them: "3x Ash Blossom", "3 Ash
 * Blossom", "Ash Blossom x3", "Ash Blossom (3)", with or without section headers,
 * bullets and trailing set codes.
 */

interface Candidate {
  copies: number;
  name: string;
}

/** `[LEDE-EN077]` / `(LEDE-EN077)` tacked onto a name by tournament list exports. */
const TRAILING_SET_CODE = /[[(][A-Z0-9]{2,5}-[A-Z]{0,2}\d{1,4}[\])]\s*$/i;

const SECTION_HEADERS: [RegExp, DeckSection | null][] = [
  [/^main[\s-]*deck\b/i, 'main'],
  [/^extra[\s-]*deck\b/i, 'extra'],
  [/^side[\s-]*deck\b/i, 'side'],
  [/^extra\b\s*[:(]/i, 'extra'],
  [/^side\b\s*[:(]/i, 'side'],
  // Type groupings inside a list carry no section of their own.
  [/^(monsters|spells|traps|skills|total|deck)\b/i, null],
];

function cleanLine(line: string): string {
  return line
    .replace(/^\s*[-*•·]\s*/, '') // bullets
    .replace(TRAILING_SET_CODE, '')
    .trim();
}

/**
 * Quantities appear on either side of the name, and some card names *start* with a
 * digit ("7 Colored Fish"). So we generate readings in priority order and let the
 * database decide which one is real, always falling back to the untouched line.
 */
function candidates(line: string): Candidate[] {
  const found: Candidate[] = [];
  const push = (copies: string, name: string) => {
    const parsed = Number.parseInt(copies, 10);
    const trimmed = name.trim();
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 99 && trimmed) {
      found.push({ copies: parsed, name: trimmed });
    }
  };

  let match = /^(\d{1,2})\s*[xX*]\s*(.+)$/.exec(line) ?? /^(\d{1,2})\s+(.+)$/.exec(line);
  if (match) push(match[1]!, match[2]!);

  match = /^[xX](\d{1,2})\s+(.+)$/.exec(line);
  if (match) push(match[1]!, match[2]!);

  match = /^(.+?)\s*[xX*]\s*(\d{1,2})$/.exec(line);
  if (match) push(match[2]!, match[1]!);

  match = /^(.+?)\s*\((\d{1,2})\)$/.exec(line);
  if (match) push(match[2]!, match[1]!);

  match = /^(.+?)\s*[|:]\s*(\d{1,2})$/.exec(line);
  if (match) push(match[2]!, match[1]!);

  found.push({ copies: 1, name: line });
  return found;
}

function resolve(line: string, db: Database): { card: Card; copies: number } | null {
  for (const candidate of candidates(line)) {
    const card = db.byName.get(normalizeName(candidate.name));
    if (card) return { card, copies: candidate.copies };
  }
  return null;
}

export function parseTextList(text: string, db: Database): Deck {
  const deck = new DeckAccumulator();
  let section: DeckSection | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = cleanLine(rawLine);
    if (!line) continue;

    // Resolve as a card first — otherwise "Monster Reborn" gets eaten by the
    // "Monsters" header rule.
    const resolved = resolve(line, db);
    if (resolved) {
      deck.add(resolved.card, section ?? defaultSection(resolved.card), resolved.copies);
      continue;
    }

    const header = SECTION_HEADERS.find(([pattern]) => pattern.test(line));
    if (header) {
      if (header[1]) section = header[1];
      continue;
    }

    deck.reject(line);
  }

  return deck.build('text');
}
