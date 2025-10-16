import React from 'react';

export type Chip = {
  id: string;
  label: string;
  text: string;
};

type Props = {
  chips: Chip[];
  onPick: (chip: Chip) => void;
};

export function ClarificationChips({ chips, onPick }: Props) {
  if (!chips.length) return null;
  return (
    <div className="clarificationChips" role="list">
      {chips.map((chip) => (
        <button
          type="button"
          key={chip.id}
          role="listitem"
          className="chip"
          onClick={() => onPick(chip)}
          data-testid={`chip-${chip.id}`}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}

