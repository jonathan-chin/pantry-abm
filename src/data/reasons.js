// Why a need went unmet.
//   left        the person set out and came back without food
//   stayedHome  the person needed food but never set out
export const UNMET_REASONS = [
  { id: 'no_food', label: 'Pantry was empty', kind: 'left' },
  { id: 'closed', label: 'Pantry was closed', kind: 'left' },
  { id: 'too_long', label: 'Gave up on the line', kind: 'left' },
  { id: 'night', label: 'Still out at night', kind: 'left' },
  { id: 'nothing_open', label: 'Nothing open', kind: 'stayedHome' },
  { id: 'weather', label: 'Kept home by weather', kind: 'stayedHome' },
  { id: 'too_far', label: 'Too far to go', kind: 'stayedHome' },
];

export const REASON_KIND = Object.fromEntries(UNMET_REASONS.map(r => [r.id, r.kind]));

export function emptyReasons() {
  return Object.fromEntries(UNMET_REASONS.map(r => [r.id, 0]));
}

// Everyone whose need has been resolved one way or the other.
export function needTotal(s) {
  return (s.served || 0) + (s.left ?? ((s.leftNoFood || 0) + (s.leftTooLong || 0))) + (s.stayedHome || 0);
}
