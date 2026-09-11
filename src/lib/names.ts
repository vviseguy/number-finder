// Short display names for long file names, keeping what tells them apart.
//
//   Alpha Client 2025 Bank Statement Jan.pdf   ┐  Alpha…Jan.pdf
//   Alpha Client 2025 Bank Statement Feb.pdf   │  Alpha…Feb.pdf
//   Beta Client 2025 Bank Statement Jan.pdf    │  Beta…Jan.pdf
//   Beta Client 2025 Bank Statement Feb.pdf    ┘  Beta…Feb.pdf
//   Alpha Client 2025 1099-INT Chase final.pdf →  …1099-INT….pdf
//   A very long workbook name for the year 2025.xlsx (no sibling) → A very long w…r 2025.xlsx
//
// Rules: a name at or under `max` characters is left alone. Otherwise every word that appears in EVERY
// file's name is dropped, wherever it sits, and each run of dropped words becomes one "…". Words are split
// on spaces, underscores, and dots only, so codes like 1099-INT and W-2 stay whole. The extension is
// always kept; anything still too long is trimmed in the middle. Two files that would end up with the
// same short name keep their full names.

const WORD_SEP = /[\s_.]+/;

function extOf(name: string): string {
  const m = /\.[A-Za-z0-9]{1,5}$/.exec(name);
  return m ? m[0] : '';
}

const stemOf = (name: string) => name.slice(0, name.length - extOf(name).length);
const wordsOf = (stem: string) => stem.split(WORD_SEP).filter(Boolean);

function middle(s: string, max: number): string {
  if (s.length <= max) return s;
  const ext = extOf(s);
  const room = Math.max(6, max - ext.length - 1);
  const head = Math.ceil(room / 2);
  const tail = Math.floor(room / 2);
  const stem = stemOf(s);
  return `${stem.slice(0, head)}…${stem.slice(stem.length - tail)}${ext}`;
}

/** Short names for a set of files, by full name. Names that would collide keep their full form. */
export function shortNames(names: string[], max = 24): Map<string, string> {
  const unique = [...new Set(names)];
  const words = unique.map(n => wordsOf(stemOf(n)));
  const lower = words.map(ws => new Set(ws.map(w => w.toLowerCase())));
  const shared = new Set<string>();
  if (unique.length >= 2) {
    for (const w of lower[0]) if (lower.every(set => set.has(w))) shared.add(w);
  }

  const shorts = unique.map((name, i) => {
    if (name.length <= max) return name;
    const ext = extOf(name);
    const kept = words[i].filter(w => !shared.has(w.toLowerCase()));
    if (!kept.length || kept.length === words[i].length) return middle(name, max);
    let out = '';
    let gap = false;
    for (const w of words[i]) {
      if (shared.has(w.toLowerCase())) { gap = true; continue; }
      out += out ? (gap ? '…' : ' ') + w : (gap ? '…' : '') + w;
      gap = false;
    }
    if (gap) out += '…';
    return middle(out + ext, max);
  });

  const counts = new Map<string, number>();
  for (const s of shorts) counts.set(s, (counts.get(s) ?? 0) + 1);
  const out = new Map<string, string>();
  unique.forEach((n, i) => out.set(n, (counts.get(shorts[i]) ?? 0) > 1 ? n : shorts[i]));
  return out;
}

export function shortName(name: string, others: string[], max = 24): string {
  return shortNames([name, ...others], max).get(name) ?? name;
}
