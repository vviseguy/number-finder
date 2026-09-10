// A small payroll workbook with an Hours column, for testing filters like "-hours".
// Run: node scripts/make-payroll-fixture.mjs   (fake data only)
import ExcelJS from 'exceljs';

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Payroll');
ws.addRow(['Employee', 'Hours', 'Gross pay']);
ws.addRow(['Pat Sample', 2080, 85000]);
ws.addRow(['Chris Example', 1040, 31200]);
ws.getColumn(3).numFmt = '#,##0.00';
ws.getRow(1).font = { bold: true };
await wb.xlsx.writeFile('fixtures/payroll.xlsx');
console.log('fixtures/payroll.xlsx');
