import { describe, expect, it } from 'vitest';
import { backupFilename, BackupError, fromBackup, toBackup } from '../src/lib/backup';
import { addCopies, UNKNOWN_SET, type Collection } from '../src/lib/collection';
import type { SavedDeck } from '../src/lib/library';

const ASH = 14558127;

const COLLECTION: Collection = addCopies(
  addCopies(addCopies(new Map(), ASH, 'PHNI', 2), ASH, 'OP27'),
  97268402,
  UNKNOWN_SET,
  3,
);

const LIBRARY: SavedDeck[] = [
  { id: 'a', name: 'Testdeck', ydke: 'ydke://!!!', savedAt: '2026-08-16T10:00:00.000Z' },
];

describe('backup', () => {
  it('carries the collection and the decks through a round trip', () => {
    const restored = fromBackup(toBackup(COLLECTION, LIBRARY));
    expect(restored.library).toEqual(LIBRARY);
    expect(Object.fromEntries(restored.collection.get(ASH)!.bySet)).toEqual({ PHNI: 2, OP27: 1 });
    expect(restored.collection.get(ASH)?.total).toBe(3);
    expect(restored.collection.get(97268402)?.total).toBe(3);
  });

  it('survives an empty account', () => {
    const restored = fromBackup(toBackup(new Map(), []));
    expect(restored.collection.size).toBe(0);
    expect(restored.library).toEqual([]);
  });

  it('names the file by date, so backups sort themselves', () => {
    expect(backupFilename(new Date('2026-08-16T22:15:00Z'))).toBe('ygo-sammlung-2026-08-16.json');
  });

  it('refuses a file that is not a backup, rather than reading half of it', () => {
    expect(() => fromBackup('not json at all')).toThrow(BackupError);
    expect(() => fromBackup('{"cards":[1,2,3]}')).toThrow(BackupError);
    expect(() => fromBackup('[]')).toThrow(BackupError);
  });

  it('refuses a backup from a newer version instead of guessing at it', () => {
    const future = JSON.stringify({ format: 'ygo-set-finder-backup', v: 99, collection: {}, library: [] });
    expect(() => fromBackup(future)).toThrow(/neueren Version/);
  });

  it('reads a backup whose deck list is damaged, keeping the collection', () => {
    const damaged = JSON.stringify({
      format: 'ygo-set-finder-backup',
      v: 1,
      collection: { [ASH]: { PHNI: 2 } },
      library: [{ nonsense: true }],
    });
    const restored = fromBackup(damaged);
    expect(restored.collection.get(ASH)?.total).toBe(2);
    expect(restored.library).toEqual([]);
  });
});
