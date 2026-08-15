import { useEffect, useMemo, useRef, useState } from 'react';
import { BudgetPanel } from './components/BudgetPanel';
import { BuyPlanPanel } from './components/BuyPlanPanel';
import { DeckList } from './components/DeckList';
import { DEFAULT_FILTERS, type FilterState } from './components/Filters';
import { ImportPanel } from './components/ImportPanel';
import { ReprintRadar } from './components/ReprintRadar';
import { SetList } from './components/SetList';
import { buildBuyPlan } from './lib/buyPlan';
import {
  collectionFromDeck,
  EMPTY_COLLECTION,
  loadCollection,
  mergeCollections,
  pruneCollection,
  saveCollection,
  withOwned,
  type Collection,
} from './lib/collection';
import { loadDatabase } from './lib/dataset';
import { countCards, parseDeck, toYdke } from './lib/import';
import { deckBudget, formatEuro } from './lib/pricing';
import { upcomingReprints, waitWarnings } from './lib/reprints';
import { deckNeeds, rankSets } from './lib/setFinder';
import { clearDeckHash, readDeckFromHash, shareUrl, writeDeckToHash } from './lib/share';
import type { Database, Deck } from './lib/types';

export function App() {
  const [db, setDb] = useState<Database | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [deck, setDeck] = useState<Deck | null>(null);
  const [editing, setEditing] = useState(true);
  const [copied, setCopied] = useState(false);
  const [collection, setCollection] = useState<Collection>(EMPTY_COLLECTION);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const collectionInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadDatabase(import.meta.env.BASE_URL)
      .then((loaded) => {
        setDb(loaded);
        setCollection(pruneCollection(loadCollection(), loaded));
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

  function analyse() {
    if (!db) return;
    const parsed = parseDeck(input, db);
    setDeck(parsed);
    if (parsed.entries.length > 0) {
      writeDeckToHash(toYdke(parsed));
      // Fold the paste box away — on a phone it is half a screen of nothing once
      // the deck is in.
      setEditing(false);
    }
  }

  function clear() {
    setDeck(null);
    setInput('');
    setEditing(true);
    clearDeckHash();
  }

  async function copyShareLink() {
    if (!deck) return;
    await navigator.clipboard.writeText(shareUrl(toYdke(deck)));
    setCopied(true);
    globalThis.setTimeout(() => setCopied(false), 2000);
  }

  async function importCollectionFile(file: File) {
    if (!db) return;
    updateCollection(mergeCollections(collection, collectionFromDeck(parseDeck(await file.text(), db))));
  }

  const analysis = useMemo(() => {
    if (!deck) return null;
    const needs = deckNeeds(deck, collection, { includeSide: filters.includeSide });
    const coverageOptions = {
      guaranteedOnly: filters.guaranteedOnly,
      includeUnreleased: filters.includeUnreleased,
      includeOutOfPrint: filters.includeOutOfPrint,
    };
    return {
      needs,
      outstanding: needs.filter((need) => need.needed > 0),
      coverage: rankSets(needs, coverageOptions),
      // The plan sticks to guaranteed products unless the filter opens it up.
      plan: buildBuyPlan(needs, { ...coverageOptions, guaranteedOnly: true }),
      upcoming: upcomingReprints(needs),
      warnings: waitWarnings(needs),
      budget: deckBudget(needs),
    };
  }, [deck, collection, filters]);

  return (
    <main>
      <header className="app">
        <h1>YGO Set Finder</h1>
        {db && <span className="meta">data {db.generated.slice(0, 10)}</span>}
      </header>

      {dbError && (
        <div className="notice error">
          <strong>Card data missing.</strong> Run <code>npm run fetch-data</code>, then reload.
        </div>
      )}
      {!db && !dbError && <p className="empty">Loading card data…</p>}

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
            <strong>{countCards(deck)} cards</strong>
            <span className="sep">·</span>
            <span className="muted">{analysis.outstanding.length} missing</span>
            <span className="sep">·</span>
            <span className="muted">{formatEuro(analysis.budget.missingCents)}</span>
            <button className="link" style={{ marginLeft: 'auto' }} onClick={() => setEditing(true)}>
              Change
            </button>
            <button className="link" onClick={() => void copyShareLink()}>
              {copied ? 'Copied' : 'Share'}
            </button>
            <button className="link" onClick={clear}>
              Clear
            </button>
          </div>
        )
      )}

      {deck && analysis && (
        <>
          <BuyPlanPanel plan={analysis.plan} />

          <SetList
            coverage={analysis.coverage}
            totalNeeded={analysis.outstanding.length}
            filters={filters}
            onFiltersChange={setFilters}
          />

          <ReprintRadar upcoming={analysis.upcoming} warnings={analysis.warnings} />
          <BudgetPanel budget={analysis.budget} />

          <input
            ref={collectionInput}
            type="file"
            accept=".ydk,.txt"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importCollectionFile(file);
              event.target.value = '';
            }}
          />
          <DeckList
            needs={analysis.needs}
            ownedCount={collection.size}
            onOwnedChange={(cardId, owned) => updateCollection(withOwned(collection, cardId, owned))}
            onResetCollection={() => updateCollection(EMPTY_COLLECTION)}
            onImportCollection={() => collectionInput.current?.click()}
            upcoming={analysis.upcoming}
          />
        </>
      )}

      <footer className="app">
        Card data from <a href="https://ygoprodeck.com/api-guide/">YGOPRODeck</a>. Cardmarket prices are estimates.
      </footer>
    </main>
  );
}
