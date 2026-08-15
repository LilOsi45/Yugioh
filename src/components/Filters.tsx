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
  { key: 'guaranteedOnly', label: 'Guaranteed only', hint: 'Hide boosters, where contents are random' },
  { key: 'includeOutOfPrint', label: 'Out of print', hint: 'Also show sets older than four years' },
  { key: 'includeUnreleased', label: 'Unreleased', hint: 'Also show sets that are announced but not out' },
  { key: 'includeSide', label: 'Side deck', hint: 'Count side deck copies as needed' },
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
