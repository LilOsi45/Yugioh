import { formatEuro, type DeckBudget } from '../lib/pricing';
import { displayName } from '../lib/dataset';

interface Props {
  budget: DeckBudget;
}

export function BudgetPanel({ budget }: Props) {
  return (
    <details className="panel">
      <summary>
        Budget <span className="count">{formatEuro(budget.missingCents)} offen</span>
      </summary>
      <div className="body">
        <div className="line">
          <span className="muted">Ganzes Deck einzeln</span>
          <span className="num">{formatEuro(budget.fullDeckCents)}</span>
        </div>
        <div className="line">
          <span className="muted">Schon im Besitz</span>
          <span className="num">{formatEuro(budget.ownedCents)}</span>
        </div>

        {budget.biggestItems.length > 0 && (
          <>
            <p className="muted" style={{ margin: '12px 0 0', fontSize: 13 }}>
              Wo das Geld hingeht
            </p>
            {budget.biggestItems.map((need) => (
              <div className="line" key={need.card.id}>
                <span>
                  {need.needed}x {displayName(need.card)}
                </span>
                <span className="num">{formatEuro(need.card.priceCents * need.needed)}</span>
              </div>
            ))}
          </>
        )}

        {budget.unpriced.length > 0 && (
          <p className="muted" style={{ marginBottom: 0, fontSize: 12.5 }}>
            Keine Preisdaten: {budget.unpriced.map((card) => displayName(card)).join(', ')}
          </p>
        )}
      </div>
    </details>
  );
}
