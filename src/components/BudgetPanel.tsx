import { formatEuro, type DeckBudget } from '../lib/pricing';

interface Props {
  budget: DeckBudget;
  planValueCents: number;
}

export function BudgetPanel({ budget, planValueCents }: Props) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Budget</h2>
        <p>Cardmarket prices in euro, refreshed with the weekly data update.</p>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="value">{formatEuro(budget.fullDeckCents)}</div>
          <div className="label">whole deck as singles</div>
        </div>
        <div className="stat">
          <div className="value">{formatEuro(budget.missingCents)}</div>
          <div className="label">still to buy</div>
        </div>
        <div className="stat">
          <div className="value">{formatEuro(budget.ownedCents)}</div>
          <div className="label">already owned</div>
        </div>
        <div className="stat">
          <div className="value">{formatEuro(planValueCents)}</div>
          <div className="label">covered by the buying plan</div>
        </div>
      </div>

      {budget.biggestItems.length > 0 && (
        <>
          <h3 style={{ marginTop: 18 }}>Where the money goes</h3>
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Card</th>
                  <th className="num">Needed</th>
                  <th className="num">Each</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {budget.biggestItems.map((need) => (
                  <tr key={need.card.id}>
                    <td>{need.card.name}</td>
                    <td className="num">{need.needed}x</td>
                    <td className="num muted">{formatEuro(need.card.priceCents)}</td>
                    <td className="num">
                      <strong>{formatEuro(need.card.priceCents * need.needed)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {budget.unpriced.length > 0 && (
        <p className="cards-inline" style={{ marginTop: 12 }}>
          No price data (excluded from the totals): {budget.unpriced.map((card) => card.name).join(', ')}
        </p>
      )}
    </section>
  );
}
