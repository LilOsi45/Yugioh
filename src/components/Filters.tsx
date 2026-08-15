export interface FilterState {
  guaranteedOnly: boolean;
  includeUnreleased: boolean;
  includeOutOfPrint: boolean;
  includeSide: boolean;
}

export const DEFAULT_FILTERS: FilterState = {
  // Off by default so the set list answers "where is this card printed", while the
  // buying plan below keeps its own stricter guaranteed-only view.
  guaranteedOnly: false,
  includeUnreleased: false,
  includeOutOfPrint: true,
  includeSide: true,
};

const OPTIONS: { key: keyof FilterState; label: string; hint: string }[] = [
  { key: 'guaranteedOnly', label: 'Guaranteed products only', hint: 'Hide boosters, where contents are random' },
  { key: 'includeUnreleased', label: 'Include unreleased sets', hint: 'Sets that are announced but not out yet' },
  { key: 'includeOutOfPrint', label: 'Include out of print', hint: 'Sets older than four years' },
  { key: 'includeSide', label: 'Count side deck', hint: 'Include side deck copies in what you need' },
];

interface Props {
  value: FilterState;
  onChange: (value: FilterState) => void;
}

export function Filters({ value, onChange }: Props) {
  return (
    <div className="row" style={{ marginTop: 0, marginBottom: 18 }}>
      {OPTIONS.map((option) => (
        <label className="check" key={option.key} title={option.hint}>
          <input
            type="checkbox"
            checked={value[option.key]}
            onChange={(event) => onChange({ ...value, [option.key]: event.target.checked })}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
