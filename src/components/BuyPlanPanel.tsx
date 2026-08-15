import type { BuyPlan } from '../lib/buyPlan';
import { PRODUCT_LABELS } from '../lib/setClassification';
import { formatEuro } from '../lib/pricing';

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
        <h2>What to buy</h2>
        <p className="empty">
          No sealed product covers what you are missing — these have to be bought as singles.
        </p>
      </section>
    );
  }

  return (
    <section className="panel plan">
      <h2>What to buy</h2>
      <p className="headline">
        <strong>
          {plan.steps.length} {plan.steps.length === 1 ? 'product' : 'products'}
        </strong>{' '}
        {plan.steps.length === 1 ? 'covers' : 'cover'} <strong>{plan.coveredCards}</strong> of your{' '}
        {plan.totalCards} missing cards
        {plan.valueCents > 0 && <> — {formatEuro(plan.valueCents)} worth of singles</>}
      </p>

      {plan.steps.map((step, index) => (
        <div className="step" key={step.set.index}>
          <div className="index">{index + 1}</div>
          <div>
            <div className="name">
              {step.set.name} <span className="muted">{step.set.code}</span>
            </div>
            <div className="gain">
              +{step.newCards.length} cards ({step.newCopies} copies)
            </div>
            <div className="cards">
              {PRODUCT_LABELS[step.set.product]} · {step.newCards.map((covered) => covered.card.name).join(', ')}
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
            <div className="name">Buy as singles</div>
            <div className="cards">
              {plan.remaining.map((need) => `${need.needed}x ${need.card.name}`).join(', ')}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
