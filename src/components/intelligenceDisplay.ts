/** Presentation only: source text remains intact in the knowledge store. */
export function cleanMechanics(text?: string | null): string {
  if (!text) return 'Ability details unavailable';
  const clean = text
    .replace(/\\n|<br\s*\/?\s*>/gi, '. ')
    .replace(/<[^>]*>/g, '')
    .replace(/with\s+@[^@]+@\s+(?:max(?:imum)?\s+)?Health/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
  const unresolved = /@[^@]+@|\{[^}]*\}|\b(?:HealthCalc|DamageCalc|TFT\d+_)\w*/i.test(clean);
  const result = clean
    .replace(/(?:for|by|with)\s+@[^@]+@\s*(?:%|seconds?|max(?:imum)? Health)?/gi, '')
    .replace(/@[^@]+@\s*%?|\{[^}]*\}/g, '')
    .replace(/\b(?:HealthCalc|DamageCalc|TFT\d+_)\w*/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
  return /[a-z]/i.test(result)
    ? result + (unresolved ? ' Detailed values unavailable.' : '')
    : 'Detailed ability values unavailable';
}
export const compactCount = (n: number | null | undefined) =>
  n == null
    ? 'Unknown'
    : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(n);
export function compactRank(rank?: string | null) {
  if (!rank) return 'Rank unknown';
  const ranks = rank
    .toUpperCase()
    .split(/[,/]/)
    .map((s) => s.trim());
  const ladder = [
    'IRON',
    'BRONZE',
    'SILVER',
    'GOLD',
    'PLATINUM',
    'EMERALD',
    'DIAMOND',
    'MASTER',
    'GRANDMASTER',
    'CHALLENGER',
  ];
  const first = ladder.findIndex((r) => ranks.includes(r));
  const labels = [
    'Iron',
    'Bronze',
    'Silver',
    'Gold',
    'Plat',
    'Emerald',
    'Diamond',
    'Master',
    'GM',
    'Challenger',
  ];
  if (first >= 0 && ladder.slice(first).every((r) => ranks.includes(r)))
    return labels[first] + (first < 9 ? '+' : '');
  return ranks.map((r) => labels[ladder.indexOf(r)] ?? 'Unknown').join(' / ');
}
