// Export tie-out results as a formatted Excel workbook or a plain CSV. Everything is built in memory
// and handed to the browser as a download; nothing leaves the computer.

export interface ExportRow {
  status: string;
  file: string;
  where: string;
  label: string;
  amount: number;
  source: string;
  difference: number | null;
}

export interface ExportMeta {
  title: string;
  settings: string;
}

const HEADERS = ['Status', 'File', 'Where', 'Label', 'Amount', 'Where it comes from', 'Difference'];

export async function exportXlsx(rows: ExportRow[], meta: ExportMeta): Promise<Blob> {
  const { default: ExcelJS } = await import('exceljs/dist/exceljs.min.js');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Number finder';
  const ws = wb.addWorksheet('Tie-out', { views: [{ state: 'frozen', ySplit: 3 }] });

  ws.getCell('A1').value = meta.title;
  ws.getCell('A1').font = { bold: true, size: 13 };
  ws.getCell('A2').value = meta.settings;
  ws.getCell('A2').font = { color: { argb: 'FF6F6E69' }, size: 10 };

  const header = ws.getRow(3);
  header.values = HEADERS;
  header.font = { bold: true };
  header.eachCell(c => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEBE6' } };
    c.border = { bottom: { style: 'thin', color: { argb: 'FFB4B2A9' } } };
  });

  const statusFill: Record<string, string> = { 'Not found': 'FFFCEBEB', Found: 'FFEAF3DE' };
  for (const r of rows) {
    const row = ws.addRow([r.status, r.file, r.where, r.label, r.amount, r.source, r.difference ?? '']);
    const fill = statusFill[r.status] ?? (r.status.startsWith('Made of') ? 'FFFAEEDA' : undefined);
    if (fill) row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  }

  const moneyFmt = '#,##0.00;[Red]-#,##0.00';
  ws.getColumn(5).numFmt = moneyFmt;
  ws.getColumn(7).numFmt = moneyFmt;
  const widths = [12, 24, 14, 36, 14, 60, 12];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.getColumn(6).alignment = { wrapText: true, vertical: 'top' };
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: HEADERS.length } };

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function exportCsv(rows: ExportRow[]): Blob {
  const cell = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [HEADERS, ...rows.map(r => [r.status, r.file, r.where, r.label, r.amount, r.source, r.difference])]
    .map(r => r.map(cell).join(','));
  // BOM so Excel opens it as UTF-8 (labels may contain "·" and "−").
  return new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
