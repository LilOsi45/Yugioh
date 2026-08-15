import type { BuyPlan } from '../lib/buyPlan';
import { PRODUCT_LABELS } from '../lib/setClassification';
import { formatEuro } from '../lib/pricing';

interface Props {
  plan: BuyPlan;
  guaranteedOnly: boolean;
}

export function BuyPlanPanel({ plan, guaranteedOnly }: Props) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Buying plan</h2>
        <p>
          {guaranteedOnly
            ? 'Products with fixed contents only, so every card listed is one you actually get.'
            : 'Boosters included — cards from those sets are a chance, not a guarantee.'}
        </p>
      </div>

      {plan.steps.length === 0 ? (
        <p className="empty">No product covers the cards you are missing. They have to be bought as singles.</p>
      ) : (
        <>
          <div className="stats" style={{ marginBottom: 8 }}>
            <div className="stat">
              <div className="value">
                {plan.coveredCards}
                <span className="muted" style={{ fontSize: 15 }}>
                  {' '}
                  / {plan.totalCards}
                </span>
              </div>
              <div className="label">cards covered</div>
            </div>
            <div className="stat">
              <div className="value">{plan.steps.length}</div>
              <div className="label">products to buy</div>
            </div>
            <div className="stat">
              <div className="value">{formatEuro(plan.valueCents)}</div>
              <div className="label">singles value replaced</div>
            </div>
          </div>

          {plan.steps.map((step, index) => (
            <div className="step" key={step.set.index}>
              <div className="index">{index + 1}</div>
              <div className="body">
                <strong>{step.set.name}</strong> <span className="muted nowrap">{step.set.code}</span>{' '}
                <span className={step.set.guaranteed ? 'badge guaranteed' : 'badge random'}>
                  {PRODUCT_LABELS[step.set.product]}
                </span>
                <p className="cards-inline">
                  +{step.newCards.length} cards ({step.newCopies} copies, {formatEuro(step.newValueCents)} of singles):{' '}
                  {step.newCards.map((covered) => covered.card.name).join(', ')}
                </p>
              </div>
            </div>
          ))}

          {plan.remaining.length > 0 && (
            <p className="cards-inline" style={{ marginTop: 14 }}>
              <strong className="muted">Buy as singles:</strong>{' '}
              {plan.remaining.map((need) => `${need.needed}x ${need.card.name}`).join(', ')}
            </p>
          )}
        </>
      )}
    </section>
  );
}
