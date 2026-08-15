export interface FilterState {
  guaranteedOnly: boolean;
  includeUnreleased: boolean;
  includeOutOfPrint: boolean;
  includeSide: boolean;
}

export const DEFAULT_FILTERS: FilterState = {
  guaranteedOnly: false,
  includeUnreleased: false,
  // Off by default: sets older than four years are the bulk of the ~100 matches a
  // real deck produces, and you cannot walk into a shop and buy them.
  includeOutOfPrint: false,
  includeSide: true,
};

const OPTIONS: { key: keyof FilterState; label: string; hint: string }[] = [
  { key: 'guaranteedOnly', label: 'Nur garantiert', hint: 'Booster ausblenden — dort ist der Inhalt Zufall' },
  { key: 'includeOutOfPrint', label: 'Vergriffen', hint: 'Auch Sets zeigen, die älter als vier Jahre sind' },
  { key: 'includeUnreleased', label: 'Unveröffentlicht', hint: 'Auch angekündigte, noch nicht erschienene Sets zeigen' },
  { key: 'includeSide', label: 'Side Deck', hint: 'Side-Deck-Kopien mitzählen' },
];

interface Props {
  value: FilterState;
  onChange: (value: FilterState) => void;
}

export function Filters({ value, onChange }: Props) {
  return (
    <div className="filters">
      {OPTIONS.map((option) => (
        <button
          key={option.key}
          className="chip"
          title={option.hint}
          aria-pressed={value[option.key]}
          onClick={() => onChange({ ...value, [option.key]: !value[option.key] })}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
