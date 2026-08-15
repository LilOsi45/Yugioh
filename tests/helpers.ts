import { buildIndex, type ApiCard, type ApiSet } from '../src/lib/buildIndex';
import { decodeDatabase } from '../src/lib/dataset';
import type { Database } from '../src/lib/types';
import fixture from './fixtures/mini-db.json';

/**
 * Frozen "today" so date-dependent behaviour (upcoming reprints, out-of-print sets)
 * is stable forever instead of rotting as the fixture ages.
 */
export const NOW = new Date('2026-08-15T00:00:00Z');

export function miniDatabase(): Database {
  return decodeDatabase(buildIndex(fixture.cards as ApiCard[], fixture.sets as ApiSet[], NOW, fixture.germanCards));
}

export function cardNamed(db: Database, name: string) {
  const card = db.cards.find((candidate) => candidate.name === name);
  if (!card) throw new Error(`fixture has no card named ${name}`);
  return card;
}

export function setNamed(db: Database, code: string) {
  const set = db.sets.find((candidate) => candidate.code === code);
  if (!set) throw new Error(`fixture has no set with code ${code}`);
  return set;
}
