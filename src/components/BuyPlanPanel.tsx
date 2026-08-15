import type { BuyPlan } from '../lib/buyPlan';
import { PRODUCT_LABELS } from '../lib/setClassification';
import { formatEuro } from '../lib/pricing';
import { displayName } from '../lib/dataset';

interface Props {
  plan: BuyPlan;
}

/**
 * The headline answer, deliberately first on the page: what to buy, in order.
 * Everything else on the screen is supporting detail.
 */
export function BuyPlanPanel({ plan }: Props) {
  if (plan.steps.length === 0) {
    return (
      <section className="panel plan">
        <h2>Was kaufen</h2>
        <p className="empty">
          Kein Produkt deckt deine fehlenden Karten ab — die musst du einzeln kaufen.
        </p>
      </section>
    );
  }

  return (
    <section className="panel plan">
      <h2>Was kaufen</h2>
      <p className="headline">
        <strong>
          {plan.steps.length} {plan.steps.length === 1 ? 'Produkt' : 'Produkte'}
        </strong>{' '}
        {plan.steps.length === 1 ? 'deckt' : 'decken'} <strong>{plan.coveredCards}</strong> deiner{' '}
        {plan.totalCards} fehlenden Karten ab
        {plan.valueCents > 0 && <> — {formatEuro(plan.valueCents)} an Einzelkarten</>}
      </p>

      {plan.steps.map((step, index) => (
        <div className="step" key={step.set.index}>
          <div className="index">{index + 1}</div>
          <div>
            <div className="name">
              {step.set.name} <span className="muted">{step.set.code}</span>
            </div>
            <div className="gain">
              +{step.newCards.length} Karten ({step.newCopies} Kopien)
            </div>
            <div className="cards">
              {PRODUCT_LABELS[step.set.product]} · {step.newCards.map((covered) => displayName(covered.card)).join(', ')}
            </div>
          </div>
        </div>
      ))}

      {plan.remaining.length > 0 && (
        <div className="step">
          <div className="index" style={{ background: 'var(--border)', color: 'var(--text-dim)' }}>
            +
          </div>
          <div>
            <div className="name">Einzeln kaufen</div>
            <div className="cards">
              {plan.remaining.map((need) => `${need.needed}x ${displayName(need.card)}`).join(', ')}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
