import { useEffect, useMemo, useRef, useState } from 'react';
import { BudgetPanel } from './components/BudgetPanel';
import { BuildMode } from './components/BuildMode';
import { BuyPlanPanel } from './components/BuyPlanPanel';
import { CollectionPanel } from './components/CollectionPanel';
import { DeckLibrary } from './components/DeckLibrary';
import { DeckList } from './components/DeckList';
import { DeckView } from './components/DeckView';
import { DEFAULT_FILTERS, type FilterState } from './components/Filters';
import { ImportPanel } from './components/ImportPanel';
import { ReprintRadar } from './components/ReprintRadar';
import { SetList } from './components/SetList';
import { StatsPanel } from './components/StatsPanel';
import { Tabs, type Tab } from './components/Tabs';
import { WantsPanel } from './components/WantsPanel';
import { backupFilename, downloadBackup, fromBackup, toBackup } from './lib/backup';
import { buildBuyPlan } from './lib/buyPlan';
import {
  collectionFromDeck,
  EMPTY_COLLECTION,
  loadCollection,
  mergeCollections,
  pruneCollection,
  saveCollection,
  setOwnedTotal,
  collectionTotals,
  type Collection,
} from './lib/collection';
import { loadDatabase } from './lib/dataset';
import { countCards, parseDeck, toYdke } from './lib/import';
import {
  addDeck,
  loadLibrary,
  removeDeck,
  renameDeck,
  saveLibrary,
  suggestDeckName,
  type SavedDeck,
} from './lib/library';
import { deckBudget, formatEuro } from './lib/pricing';
import { upcomingReprints, waitWarnings } from './lib/reprints';
import { deckNeeds, rankSets } from './lib/setFinder';
import { clearDeckHash, readDeckFromHash, shareUrl, writeDeckToHash } from './lib/share';
import type { Database, Deck } from './lib/types';

export function App() {
  const [db, setDb] = useState<Database | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('analyse');
  const [input, setInput] = useState('');
  const [deck, setDeck] = useState<Deck | null>(null);
  const [editing, setEditing] = useState(true);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [collection, setCollection] = useState<Collection>(EMPTY_COLLECTION);
  const [library, setLibrary] = useState<SavedDeck[]>([]);
  const [building, setBuilding] = useState<SavedDeck | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [notice, setNotice] = useState<string | null>(null);
  const collectionInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadDatabase(import.meta.env.BASE_URL)
      .then((loaded) => {
        setDb(loaded);
        setCollection(pruneCollection(loadCollection(), loaded));
        setLibrary(loadLibrary());
        const shared = readDeckFromHash();
        if (shared) {
          setInput(shared);
          setDeck(parseDeck(shared, loaded));
          setEditing(false);
        }
      })
      .catch((error: unknown) => setDbError(error instanceof Error ? error.message : String(error)));
  }, []);

  function updateCollection(next: Collection) {
    setCollection(next);
    saveCollection(next);
  }

  function updateLibrary(next: SavedDeck[]) {
    setLibrary(next);
    saveLibrary(next);
  }

  function analyse() {
    if (!db) return;
    const parsed = parseDeck(input, db);
    setDeck(parsed);
    setSaved(false);
    if (parsed.entries.length > 0) {
      writeDeckToHash(toYdke(parsed));
      setEditing(false);
    }
  }

  function saveCurrentDeck() {
    if (!deck || deck.entries.length === 0) return;
    const name = globalThis.prompt('Deck benennen', suggestDeckName(deck));
    if (!name) return;
    updateLibrary(addDeck(library, name, toYdke(deck)));
    setSaved(true);
  }

  function openSaved(entry: SavedDeck) {
    if (!db) return;
    setInput(entry.ydke);
    setDeck(parseDeck(entry.ydke, db));
    setEditing(false);
    setSaved(true);
    setBuilding(null);
    setTab('analyse');
    writeDeckToHash(entry.ydke);
  }

  function clear() {
    setDeck(null);
    setInput('');
    setEditing(true);
    setSaved(false);
    clearDeckHash();
  }

  async function copyShareLink() {
    if (!deck) return;
    await navigator.clipboard.writeText(shareUrl(toYdke(deck)));
    setCopied(true);
    globalThis.setTimeout(() => setCopied(false), 2000);
  }

  /**
   * One input for both jobs: a backup file restores everything, a decklist adds its
   * cards. Telling them apart by content rather than by asking is one decision less
   * on a phone.
   */
  async function importCollectionFile(file: File) {
    if (!db) return;
    const text = await file.text();

    if (text.includes('ygo-set-finder-backup')) {
      try {
        const backup = fromBackup(text);
        const replace =
          collection.size === 0 ||
          globalThis.confirm(
            'Sicherung einspielen:\n\nOK = deine jetzige Sammlung ersetzen\nAbbrechen = dazuzählen',
          );
        updateCollection(
          pruneCollection(replace ? backup.collection : mergeCollections(collection, backup.collection), db),
        );
        if (backup.library.length > 0) {
          updateLibrary(replace ? backup.library : [...backup.library, ...library]);
        }
        setNotice(
          `Sicherung eingespielt: ${backup.collection.size} Karten, ${backup.library.length} Decks.`,
        );
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'Die Datei konnte nicht gelesen werden.');
      }
      return;
    }

    updateCollection(mergeCollections(collection, collectionFromDeck(parseDeck(text, db))));
  }

  function exportBackup() {
    downloadBackup(toBackup(collection, library), backupFilename());
    setNotice('Sicherung heruntergeladen. Leg sie irgendwo ab, wo sie dein Handy nicht wegräumt.');
  }

  const analysis = useMemo(() => {
    if (!deck) return null;
    const needs = deckNeeds(deck, collectionTotals(collection), { includeSide: filters.includeSide });
    const coverageOptions = {
      guaranteedOnly: filters.guaranteedOnly,
      includeUnreleased: filters.includeUnreleased,
      includeOutOfPrint: filters.includeOutOfPrint,
    };
    return {
      needs,
      outstanding: needs.filter((need) => need.needed > 0),
      coverage: rankSets(needs, coverageOptions),
      plan: buildBuyPlan(needs, { ...coverageOptions, guaranteedOnly: true }),
      upcoming: upcomingReprints(needs),
      warnings: waitWarnings(needs),
      budget: deckBudget(needs),
    };
  }, [deck, collection, filters]);

  const hiddenCollectionInput = (
    <input
      ref={collectionInput}
      type="file"
      accept=".ydk,.txt,.json"
      hidden
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void importCollectionFile(file);
        event.target.value = '';
      }}
    />
  );

  return (
    <main>
      <header className="app">
        <h1>YGO Set Finder</h1>
        {db && <span className="meta">Stand {db.generated.slice(0, 10)}</span>}
      </header>

      {dbError && (
        <div className="notice error">
          <strong>Kartendaten fehlen.</strong> <code>npm run fetch-data</code> ausführen und neu laden.
        </div>
      )}
      {!db && !dbError && <p className="empty">Lade Kartendaten…</p>}

      {db && (
        <Tabs
          active={tab}
          onChange={(next) => {
            setTab(next);
            setBuilding(null);
          }}
          deckCount={library.length}
          cardCount={collection.size}
        />
      )}

      {db && tab === 'analyse' && (
        <>
          {editing || !deck ? (
            <ImportPanel
              value={input}
              onChange={setInput}
              onSubmit={analyse}
              deck={deck}
              onCancel={deck ? () => setEditing(false) : null}
            />
          ) : (
            analysis && (
              <div className="deckbar">
                <strong>{countCards(deck)} Karten</strong>
                <span className="sep">·</span>
                <span className="muted">{analysis.outstanding.length} fehlen</span>
                <span className="sep">·</span>
                <span className="muted">{formatEuro(analysis.budget.missingCents)}</span>
                <button className="link" style={{ marginLeft: 'auto' }} onClick={saveCurrentDeck}>
                  {saved ? 'Gespeichert ✓' : 'Deck speichern'}
                </button>
                <button className="link" onClick={() => setEditing(true)}>
                  Ändern
                </button>
                <button className="link" onClick={() => void copyShareLink()}>
                  {copied ? 'Kopiert' : 'Teilen'}
                </button>
                <button className="link" onClick={clear}>
                  Leeren
                </button>
              </div>
            )
          )}

          {/* Folding the import box away hid this warning at exactly the moment it
              matters: right after an import where lines failed to resolve. */}
          {!editing && deck && deck.unresolved.length > 0 && (
            <div className="notice">
              <strong>{deck.unresolved.length} Zeile(n) nicht erkannt</strong> und übersprungen:{' '}
              <span className="muted">{deck.unresolved.slice(0, 4).join(' · ')}</span>
              {deck.unresolved.length > 4 && <span className="muted"> …</span>}{' '}
              <button className="link" onClick={() => setEditing(true)}>
                korrigieren
              </button>
            </div>
          )}

          {deck && analysis && (
            <>
              <BuyPlanPanel plan={analysis.plan} />
              <DeckView deck={deck} collection={collection} showOwnership />
              <SetList
                coverage={analysis.coverage}
                totalNeeded={analysis.outstanding.length}
                filters={filters}
                onFiltersChange={setFilters}
              />
              <ReprintRadar upcoming={analysis.upcoming} warnings={analysis.warnings} />
              <BudgetPanel budget={analysis.budget} />
              {hiddenCollectionInput}
              <DeckList
                needs={analysis.needs}
                ownedCount={collection.size}
                onOwnedChange={(cardId, owned) => updateCollection(setOwnedTotal(collection, cardId, owned))}
                onResetCollection={() => updateCollection(EMPTY_COLLECTION)}
                onImportCollection={() => collectionInput.current?.click()}
                upcoming={analysis.upcoming}
              />
            </>
          )}
        </>
      )}

      {db && tab === 'decks' &&
        (building ? (
          <BuildMode
            saved={building}
            db={db}
            collection={collection}
            onChange={updateCollection}
            onBack={() => setBuilding(null)}
          />
        ) : (
          <>
          <DeckLibrary
            library={library}
            db={db}
            collection={collection}
            onBuild={setBuilding}
            onOpen={openSaved}
            onRemove={(id) => updateLibrary(removeDeck(library, id))}
            onRename={(id, name) => updateLibrary(renameDeck(library, id, name))}
          />
          <WantsPanel library={library} db={db} collection={collection} />
          </>
        ))}

      {db && tab === 'collection' && (
        <>
          {hiddenCollectionInput}
          <CollectionPanel
            db={db}
            collection={collection}
            deckCount={library.length}
            notice={notice}
            onDismissNotice={() => setNotice(null)}
            onChange={updateCollection}
            onReset={() => updateCollection(EMPTY_COLLECTION)}
            onImport={() => collectionInput.current?.click()}
            onExport={exportBackup}
          >
            <StatsPanel db={db} collection={collection} />
          </CollectionPanel>
        </>
      )}

      <footer className="app">
        Kartendaten von <a href="https://ygoprodeck.com/api-guide/">YGOPRODeck</a>. Cardmarket-Preise sind Schätzwerte.
      </footer>
    </main>
  );
}
