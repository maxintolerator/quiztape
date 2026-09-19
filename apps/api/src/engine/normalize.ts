/**
 * Text normalisation for fuzzy grading. Both the accepted answers and the
 * player's input go through the same pipeline before comparison.
 */
/** Latin letters that NFKD does not decompose into an ASCII base. */
const TRANSLITERATE: Record<string, string> = { æ: 'ae', ø: 'o', œ: 'oe', ß: 'ss', ð: 'd', þ: 'th', ł: 'l', đ: 'd', ħ: 'h', ı: 'i', ŋ: 'n', ŧ: 't' };

export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[æøœßðþłđħıŋŧ]/g, (ch) => TRANSLITERATE[ch] ?? ch)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the\s+/, '')
    .replace(/\s+/g, ' ');
}

/** Strip edition / remaster suffixes so "OK Computer (Remastered)" also accepts "OK Computer". */
export function stripEditionSuffix(title: string): string {
  return title
    .replace(/\s*[([][^)\]]*(remaster|deluxe|edition|version|anniversary|expanded|bonus|mono|stereo|live|explicit|feat\.?|ft\.?)[^)\]]*[)\]]\s*$/i, '')
    .replace(/\s+-\s+(remaster(ed)?( \d{4})?|deluxe( edition)?|\d{4} remaster(ed)?|single version|radio edit)\s*$/i, '')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[b.length]!;
}

/** 1 = identical, 0 = nothing in common, after normalisation. */
export function similarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na === nb) return 1;
  const longest = Math.max(na.length, nb.length);
  if (longest === 0) return 0;
  return 1 - levenshtein(na, nb) / longest;
}

/** Best similarity of `input` against any accepted answer. */
export function bestMatch(input: string, accepted: readonly string[]): { score: number; matched: string | null } {
  let best = { score: 0, matched: null as string | null };
  for (const candidate of accepted) {
    const score = similarity(input, candidate);
    if (score > best.score) best = { score, matched: candidate };
  }
  return best;
}
