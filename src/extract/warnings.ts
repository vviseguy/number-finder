/** Plain-language notices shown in the file list. */
export const WARNING = {
  scan: 'No readable numbers — this looks like a scan',
  pdfPassword: 'This PDF is password-protected. Save a copy without the password and add it again.',
  workbookPassword: 'This workbook is password-protected. Save a copy without the password and add it again.',
  unreadable: "Couldn't read this file.",
  noNumbers: 'No numbers found in this file.',
  unsupported: "Number finder can't read this kind of file. Use PDF, Excel, or CSV.",
} as const;

/** [3, 4] → "Pages 3–4 have no readable text (scanned?)"; [2] → "Page 2 has …"; [1, 3, 4] → "Pages 1, 3–4 have …". */
export function blankPagesWarning(pages: number[]): string {
  return `${pageList(pages)} ${pages.length === 1 ? 'has' : 'have'} no readable text (scanned?)`;
}

/** [5] → "Couldn't read page 5." */
export function failedPagesWarning(pages: number[]): string {
  return `Couldn't read ${pageList(pages).toLowerCase()}.`;
}

function pageList(pages: number[]): string {
  const sorted = [...pages].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? `${sorted[i]}` : `${sorted[i]}–${sorted[j]}`);
    i = j + 1;
  }
  return `${sorted.length === 1 ? 'Page' : 'Pages'} ${parts.join(', ')}`;
}
