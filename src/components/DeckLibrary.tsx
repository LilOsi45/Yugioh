import { deckProgress, type SavedDeck } from '../lib/library';
import { parseDeck } from '../lib/import';
import { deckNeeds } from '../lib/setFinder';
import type { Collection } from '../lib/collection';
import type { Database } from '../lib/types';

interface Props {
  library: SavedDeck[];
  db: Database;
  collection: Collection;
  onBuild: (deck: SavedDeck) => void;
  onOpen: (deck: SavedDeck) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

export function DeckLibrary({ library, db, collection, onBuild, onOpen, onRemove, onRename }: Props) {
  if (library.length === 0) {
    return (
      <section className="panel">
        <h2>Gespeicherte Decks</h2>
        <p className="empty">
          Noch keine Decks. Unter <strong>Analyse</strong> ein Deck einfügen und <strong>Deck speichern</strong> tippen.
        </p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Gespeicherte Decks</h2>
      {library.map((saved) => {
        const deck = parseDeck(saved.ydke, db);
        const progress = deckProgress(deckNeeds(deck, collection));
        const percent = Math.round(progress.ratio * 100);

        return (
          <div className="saved" key={saved.id}>
            <button className="saved-main" onClick={() => onBuild(saved)}>
              <div className="saved-head">
                <span className="name">{saved.name}</span>
                <span className={progress.complete ? 'badge guaranteed' : 'badge'}>
                  {progress.complete ? 'vollständig' : `${progress.missingCards} fehlen`}
                </span>
              </div>
              <div className="bar">
                <div className="fill" style={{ width: `${percent}%` }} />
              </div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                {progress.owned} von {progress.required} Kopien · {percent}%
                {!progress.complete && ' · antippen zum Bauen'}
              </div>
            </button>
            <div className="row" style={{ marginTop: 6 }}>
              <button className="link" onClick={() => onOpen(saved)}>
                Analysieren
              </button>
              <button
                className="link"
                onClick={() => {
                  const name = globalThis.prompt('Deckname', saved.name);
                  if (name) onRename(saved.id, name);
                }}
              >
                Umbenennen
              </button>
              <button
                className="link"
                onClick={() => {
                  if (globalThis.confirm(`"${saved.name}" löschen?`)) onRemove(saved.id);
                }}
              >
                Löschen
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
