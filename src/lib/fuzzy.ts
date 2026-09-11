// "~word" in the search bar: the text must contain something close to the word.
//
// Rule: compare letters and digits only, case-insensitively (so ~1099int finds "1099-INT" and ~intrest
// finds "Interest income"). The word may differ from the closest stretch of text by up to one edit
// (a typo, a missing or extra letter) for words of 4–7 characters, two edits from 8 on, and none below 4.

/** Letters and digits only, lower-case. */
export const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

export function allowedEdits(length: number): number {
  return length >= 8 ? 2 : length >= 4 ? 1 : 0;
}

/**
 * Smallest edit distance between the pattern and any substring of the text (Sellers' algorithm).
 * Both are compared as given: squash them first for the bar's rule.
 */
export function substringDistance(pattern: string, text: string): number {
  if (!pattern) return 0;
  const m = pattern.length;
  let prev = new Array<number>(m + 1);
  let cur = new Array<number>(m + 1);
  for (let i = 0; i <= m; i++) prev[i] = i; // deleting the pattern's first i characters
  let best = prev[m];
  for (let j = 1; j <= text.length; j++) {
    cur[0] = 0; // a match may start anywhere in the text
    const c = text.charCodeAt(j - 1);
    for (let i = 1; i <= m; i++) {
      const same = pattern.charCodeAt(i - 1) === c ? 0 : 1;
      cur[i] = Math.min(prev[i - 1] + same, prev[i] + 1, cur[i - 1] + 1);
    }
    if (cur[m] < best) best = cur[m];
    if (best === 0) return 0;
    [prev, cur] = [cur, prev];
  }
  return best;
}

/** Does the text contain something close enough to the word? */
export function fuzzyIncludes(text: string, word: string): boolean {
  const p = squash(word);
  if (!p) return true;
  return substringDistance(p, squash(text)) <= allowedEdits(p.length);
}
