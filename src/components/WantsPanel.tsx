import { useMemo, useState } from 'react';
import { buildBuyPlan } from '../lib/buyPlan';
import { collectionTotals, type Collection } from '../lib/collection';
import { displayName } from '../lib/dataset';
import { deckBudget, formatEuro } from '../lib/pricing';
import { formatDaysUntil, upcomingReprints } from '../lib/reprints';
import { copyText, needsAsText } from '../lib/tradeText';
import { combinedNeeds } from '../lib/wants';
import type { SavedDeck } from '../lib/library';
import type { Database } from '../lib/types';

interface Props {
  library: SavedDeck[];
  db: Database;
  collection: Collection;
}

const PAGE = 12;

/**
 * One shopping list for every saved deck at once — the question you actually have in
 * a shop, where you are not buying for one deck but for the binder.
 */
export function WantsPanel({ library, db, collection }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const { missing, plan, budget, reprints } = useMemo(() => {
    const needs = combinedNeeds(library, db, collectionTotals(collection));
    return {
      missing: needs.filter((need) => need.needed > 0),
      plan: buildBuyPlan(needs, { guaranteedOnly: true }),
      budget: deckBudget(needs),
      // The same radar the deck view uses, pointed at everything still missing.
      reprints: upcomingReprints(needs),
    };
  }, [library, db, collection]);

  async function copy() {
    const text = needsAsText(missing);
    setCopied(
      (await copyText(text))
        ? 'Wantlist kopiert — direkt bei Cardmarket oder in den Chat einfügen.'
        : text,
    );
  }

  if (library.length === 0) return null;

  if (missing.length === 0) {
    return (
      <section className="panel">
        <h2>Wantlist</h2>
        <p className="empty">Über alle {library.length} Decks fehlt dir nichts mehr.</p>
      </section>
    );
  }

  const copies = missing.reduce((sum, need) => sum + need.needed, 0);

  return (
    <section className="panel">
      <h2>Wantlist</h2>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>
        {missing.length} Karten · {copies} Kopien · {formatEuro(budget.missingCents)} als Einzelkarten. Eine
        Karte, die in mehreren Decks steckt, zählt nur einmal.
      </p>

      <div className="row" style={{ marginTop: 0 }}>
        <button onClick={() => void copy()}>Wantlist kopieren</button>
      </div>
      {copied && (copied.includes('\n') || !copied.startsWith('Wantlist kopiert') ? (
        <>
          <p className="muted" style={{ fontSize: 12.5, margin: '8px 0 4px' }}>
            Die Zwischenablage ist hier gesperrt — Text markieren und selbst kopieren:
          </p>
          <textarea readOnly rows={6} value={copied} onFocus={(e) => e.target.select()} />
        </>
      ) : (
        <div className="notice">{copied}</div>
      ))}

      {/* Buying a card weeks before it is reprinted is the most expensive mistake
          this app can prevent, so it goes above the list, not below it. */}
      {reprints.length > 0 && (
        <div className="notice">
          <strong>Warten lohnt sich:</strong> {reprints.length}{' '}
          {reprints.length === 1 ? 'Karte' : 'Karten'} von deiner Wantlist{' '}
          {reprints.length === 1 ? 'kommt' : 'kommen'} neu heraus.
          {reprints.slice(0, 3).map((news) => (
            <div className="muted" key={news.card.id} style={{ fontSize: 12.5, marginTop: 3 }}>
              {news.card.name} — {news.printing.set.code} {formatDaysUntil(news.daysUntil)}
            </div>
          ))}
        </div>
      )}

      {plan.steps.length > 0 && (
        <>
          <h3 className="coll-heading">Beste Kaufreihenfolge</h3>
          {plan.steps.map((step) => (
            <div className="line" key={step.set.code}>
              <span>
                <strong>{step.set.code}</strong>{' '}
                <span className="muted" style={{ fontSize: 12.5 }}>
                  {step.set.name}
                </span>
              </span>
              <span className="num">
                +{step.newCards.length} <span className="muted">Karten</span>
              </span>
            </div>
          ))}
        </>
      )}

      <h3 className="coll-heading">Was fehlt</h3>
      {missing.slice(0, expanded ? missing.length : PAGE).map((need) => (
        <div className="line" key={need.card.id}>
          <span>
            {displayName(need.card)}
            {need.owned > 0 && (
              <span className="muted" style={{ fontSize: 12.5 }}>
                {' '}
                · {need.owned} von {need.required} da
              </span>
            )}
          </span>
          <span className="num">
            <strong>{need.needed}×</strong>
            {need.card.priceCents > 0 && (
              <span className="muted"> {formatEuro(need.card.priceCents * need.needed)}</span>
            )}
          </span>
        </div>
      ))}
      {missing.length > PAGE && !expanded && (
        <button className="link" onClick={() => setExpanded(true)}>
          alle {missing.length} zeigen
        </button>
      )}
    </section>
  );
}
