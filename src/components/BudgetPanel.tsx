import { formatEuro, type DeckBudget } from '../lib/pricing';

interface Props {
  budget: DeckBudget;
}

export function BudgetPanel({ budget }: Props) {
  return (
    <details className="panel">
      <summary>
        Budget <span className="count">{formatEuro(budget.missingCents)} to buy</span>
      </summary>
      <div className="body">
        <div className="line">
          <span className="muted">Whole deck as singles</span>
          <span className="num">{formatEuro(budget.fullDeckCents)}</span>
        </div>
        <div className="line">
          <span className="muted">Already owned</span>
          <span className="num">{formatEuro(budget.ownedCents)}</span>
        </div>

        {budget.biggestItems.length > 0 && (
          <>
            <p className="muted" style={{ margin: '12px 0 0', fontSize: 13 }}>
              Where the money goes
            </p>
            {budget.biggestItems.map((need) => (
              <div className="line" key={need.card.id}>
                <span>
                  {need.needed}x {need.card.name}
                </span>
                <span className="num">{formatEuro(need.card.priceCents * need.needed)}</span>
              </div>
            ))}
          </>
        )}

        {budget.unpriced.length > 0 && (
          <p className="muted" style={{ marginBottom: 0, fontSize: 12.5 }}>
            No price data: {budget.unpriced.map((card) => card.name).join(', ')}
          </p>
        )}
      </div>
    </details>
  );
}
