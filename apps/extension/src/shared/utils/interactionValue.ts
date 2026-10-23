import { parseDateAtom } from './date';
import { choiceTextMatches } from './text';

/** Goal semantics, independent of any component's DOM/class names. Numeric choice matches remain exact. */
export function interactionValueMatches(candidate: string, goal: string, label: string): boolean {
  if (choiceTextMatches(candidate, goal)) return true;
  if (/(?:月|month)/iu.test(label) && /^\d{1,2}$/.test(goal)) {
    const month = /^(\d{1,2})\s*(?:月|月份)$/u.exec(candidate.trim());
    if (month && +goal >= 1 && +goal <= 12) return +month[1]! === +goal;
  }
  const expected = parseDateAtom(goal);
  const observed = parseDateAtom(candidate);
  if (!expected || !observed || 'present' in expected || 'present' in observed) return false;
  return expected.year === observed.year && (expected.precision === 'year' || expected.month === observed.month &&
    (expected.precision === 'month' || expected.day === observed.day));
}
