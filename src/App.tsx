import { useEffect, useMemo, useRef, useState } from 'react';
import { BudgetPanel } from './components/BudgetPanel';
import { BuyPlanPanel } from './components/BuyPlanPanel';
import { DeckTable } from './components/DeckTable';
import { DEFAULT_FILTERS, Filters, type FilterState } from './components/Filters';
import { ImportPanel } from './components/ImportPanel';
import { ReprintRadar } from './components/ReprintRadar';
import { SetFinderTable } from './components/SetFinderTable';
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
import { deckBudget } from './lib/pricing';
import { recentReprints, upcomingReprints, waitWarnings } from './lib/reprints';
import { deckNeeds, rankSets } from './lib/setFinder';
import { clearDeckHash, readDeckFromHash, shareUrl, writeDeckToHash } from './lib/share';
import type { Database, Deck } from './lib/types';

export function App() {
  const [db, setDb] = useState<Database | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [deck, setDeck] = useState<Deck | null>(null);
  const [collection, setCollection] = useState<Collection>(EMPTY_COLLECTION);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const collectionInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadDatabase(import.meta.env.BASE_URL)
      .then((loaded) => {
        setDb(loaded);
        setCollection(pruneCollection(loadCollection(), loaded));
        // A shared link carries the deck in the hash.
        const shared = readDeckFromHash();
        if (shared) {
          setInput(shared);
          setDeck(parseDeck(shared, loaded));
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
    if (parsed.entries.length > 0) writeDeckToHash(toYdke(parsed));
  }

  function clear() {
    setDeck(null);
    setInput('');
    clearDeckHash();
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
    const outstanding = needs.filter((need) => need.needed > 0);
    return {
      needs,
      outstanding,
      coverage: rankSets(needs, coverageOptions),
      // The plan always sticks to guaranteed products unless the filter opens it up.
      plan: buildBuyPlan(needs, { ...coverageOptions, guaranteedOnly: true }),
      upcoming: upcomingReprints(needs),
      warnings: waitWarnings(needs),
      recent: recentReprints(needs),
      budget: deckBudget(needs),
    };
  }, [deck, collection, filters]);

  return (
    <main>
      <header className="app">
        <h1>YGO Set Finder</h1>
        <span className="tagline">which sets cover your deck — and what to buy first</span>
        {db && <span className="meta">card data {db.generated.slice(0, 10)}</span>}
      </header>

      {dbError && (
        <div className="notice error">
          <strong>Card data missing.</strong> {dbError}
          <br />
          Run <code>npm run fetch-data</code> to download it from YGOPRODeck, then reload.
        </div>
      )}

      <ImportPanel
        value={input}
        onChange={setInput}
        onSubmit={analyse}
        onClear={clear}
        deck={deck}
        shareLink={deck && deck.entries.length > 0 ? shareUrl(toYdke(deck)) : null}
      />

      {!db && !dbError && <p className="empty">Loading card data…</p>}

      {deck && analysis && (
        <>
          <div className="stats" style={{ marginBottom: 18 }}>
            <div className="stat">
              <div className="value">{countCards(deck)}</div>
              <div className="label">cards in deck</div>
            </div>
            <div className="stat">
              <div className="value">{analysis.needs.length}</div>
              <div className="label">distinct cards</div>
            </div>
            <div className="stat">
              <div className="value">{analysis.outstanding.length}</div>
              <div className="label">still missing</div>
            </div>
            <div className="stat">
              <div className="value">{analysis.coverage[0]?.distinctCards ?? 0}</div>
              <div className="label">best single set</div>
            </div>
          </div>

          <Filters value={filters} onChange={setFilters} />

          <SetFinderTable coverage={analysis.coverage} totalNeeded={analysis.outstanding.length} />
          <BuyPlanPanel plan={analysis.plan} guaranteedOnly />
          <ReprintRadar upcoming={analysis.upcoming} warnings={analysis.warnings} recent={analysis.recent} />
          <BudgetPanel budget={analysis.budget} planValueCents={analysis.plan.valueCents} />

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
          <DeckTable
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
        Card data from <a href="https://ygoprodeck.com/api-guide/">YGOPRODeck</a>. Prices are Cardmarket averages and
        are only as fresh as the last data refresh. Not affiliated with Konami.
      </footer>
    </main>
  );
}
