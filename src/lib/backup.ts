import { parseCollection, serializeCollection, type Collection } from './collection';
import { parseLibrary, type SavedDeck } from './library';

/**
 * A whole account in one file: everything the app knows lives in this browser's
 * localStorage and nowhere else.
 *
 * Recording a collection by hand is hours of work, and localStorage is not a safe
 * place to keep hours of work — clearing browsing data wipes it, iOS evicts storage
 * from sites it considers idle, and a new phone starts empty. An export is the only
 * thing standing between the user and starting over.
 *
 * Decks travel with the collection because losing either alone is just as annoying,
 * and one file is one thing to remember.
 */
export const BACKUP_VERSION = 1;

export interface Backup {
  collection: Collection;
  library: SavedDeck[];
}

interface BackupFile {
  format: string;
  v: number;
  exportedAt: string;
  /** Same shape as the stored collection: `{passcode: {SET: count}}`. */
  collection: Record<string, Record<string, number>>;
  library: SavedDeck[];
}

/** Marks the file as ours, so a wrong file is refused instead of half-read. */
const FORMAT = 'ygo-set-finder-backup';

export function toBackup(collection: Collection, library: SavedDeck[], now = new Date()): string {
  const file: BackupFile = {
    format: FORMAT,
    v: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    collection: JSON.parse(serializeCollection(collection)) as BackupFile['collection'],
    library,
  };
  // Indented: a backup is something a person might open and look at.
  return JSON.stringify(file, null, 2);
}

/** Name that sorts by date and says what it is, for a phone's Files app. */
export function backupFilename(now = new Date()): string {
  return `ygo-sammlung-${now.toISOString().slice(0, 10)}.json`;
}

export class BackupError extends Error {}

/**
 * Reads a backup file, or refuses it.
 *
 * Refusing is the point: a half-read backup silently missing half a collection is
 * worse than a clear "that is not a backup file", because the user would only notice
 * once the original is long gone.
 */
export function fromBackup(text: string): Backup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupError('Das ist keine gültige Sicherungsdatei.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BackupError('Das ist keine gültige Sicherungsdatei.');
  }

  const file = parsed as Partial<BackupFile>;
  if (file.format !== FORMAT) {
    throw new BackupError('Diese Datei stammt nicht aus dieser App.');
  }
  if (typeof file.v !== 'number' || file.v > BACKUP_VERSION) {
    throw new BackupError('Die Datei stammt aus einer neueren Version. Bitte die App aktualisieren.');
  }

  return {
    collection: parseCollection(JSON.stringify(file.collection ?? {})),
    library: parseLibrary(JSON.stringify(file.library ?? [])),
  };
}

/** Hands the file to the browser's download machinery. */
export function downloadBackup(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Freeing immediately can cancel the download on some browsers.
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
