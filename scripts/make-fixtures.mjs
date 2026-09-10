// Generates the test fixtures in fixtures/: fake tax documents (no real people) for extraction tests and the UI.
// Run: node scripts/make-fixtures.mjs
//
// The numbers tell a small story on purpose: the W-2 says federal withholding 9,102.00 but the 1040 draft says 9,120;
// Schedule B line 1 says 3,253 but line 4 says 3,235 — transpositions for Number finder to catch.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const FIXED_DATE = new Date('2026-01-15T12:00:00Z'); // keeps metadata stable between runs
const BLACK = rgb(0, 0, 0);

mkdirSync(OUT, { recursive: true });

// ---------- PDF helpers ----------

async function newPdf(title) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor('Number finder test fixture (fake data)');
  doc.setCreator('scripts/make-fixtures.mjs');
  doc.setProducer('pdf-lib');
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  const f = {
    reg: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.Courier),
    monoBold: await doc.embedFont(StandardFonts.CourierBold),
  };
  return { doc, f };
}

/** Page drawing helpers bound to one page. */
function pen(page, f) {
  const text = (str, x, y, size = 8, font = f.reg) => page.drawText(str, { x, y, size, font, color: BLACK });
  return {
    text,
    right: (str, xRight, y, size = 10, font = f.mono) => text(str, xRight - font.widthOfTextAtSize(str, size), y, size, font),
    /** Label followed by leader dots up to toX, like the lines of a 1040. */
    leaders(str, x, toX, y, size = 8, font = f.reg) {
      let s = `${str} `;
      while (x + font.widthOfTextAtSize(`${s}. `, size) <= toX) s += '. ';
      text(s.trimEnd(), x, y, size, font);
    },
    box: (x, y, width, height) => page.drawRectangle({ x, y, width, height, borderColor: BLACK, borderWidth: 0.5 }),
    rule: (x1, y1, x2, y2) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.5, color: BLACK }),
  };
}

async function save(doc, name) {
  writeFileSync(join(OUT, name), await doc.save());
  console.log(`wrote fixtures/${name}`);
}

// ---------- W-2: box captions ABOVE values ----------

async function w2() {
  const { doc, f } = await newPdf('Form W-2 (sample, fake data)');
  const page = doc.addPage([612, 792]);
  const p = pen(page, f);
  const cap = (s, x, y) => p.text(s, x, y, 6.5);
  const val = (s, x, y) => p.text(s, x, y, 10, f.mono);

  p.box(36, 722, 180, 30);
  p.box(216, 722, 360, 30);
  p.box(36, 692, 270, 30);
  p.box(306, 692, 135, 30);
  p.box(441, 692, 135, 30);
  p.box(36, 638, 270, 54);
  p.box(306, 662, 135, 30);
  p.box(441, 662, 135, 30);
  p.box(306, 638, 270, 24);
  p.box(36, 584, 270, 54);
  p.box(306, 584, 270, 54);

  cap("a  Employee's social security number", 40, 743);
  val('000-00-0000', 40, 728);
  p.text('OMB No. 1545-0029', 220, 743, 7);

  cap('b  Employer identification number (EIN)', 40, 713);
  val('12-3456789', 40, 698);
  cap('1  Wages, tips, other compensation', 310, 713);
  val('85,000.00', 310, 698);
  cap('2  Federal income tax withheld', 445, 713);
  val('9,102.00', 445, 698);

  cap("c  Employer's name, address, and ZIP code", 40, 683);
  val('Acme Widget Co.', 40, 668);
  val('PO Box 500', 40, 656);
  val('Anytown, IL 12345', 40, 644);
  cap('3  Social security wages', 310, 683);
  val('85,000.00', 310, 668);
  cap('4  Social security tax withheld', 445, 683);
  val('5,270.00', 445, 668);
  cap('12a  See instructions for box 12', 310, 653);

  cap("e  Employee's first name and initial     Last name", 40, 629);
  val('Pat Q. Sample', 40, 614);
  val('200 Oak Avenue', 40, 602);
  val('Lakeview, IL 12345-6789', 40, 590);
  cap('13  Statutory employee   Retirement plan   Third-party sick pay', 310, 629);

  p.text('Form W-2  Wage and Tax Statement', 40, 560, 11, f.bold);
  p.text('2025', 300, 558, 18, f.bold);
  p.text('Department of the Treasury—Internal Revenue Service', 400, 562, 7);
  p.text("Copy B—To Be Filed With Employee's FEDERAL Tax Return.", 40, 546, 7);
  await save(doc, 'W-2.pdf');
}

// ---------- 1099-INT: captions LEFT of values, "$" drawn as its own text item ----------

async function payerBlock(p, f, lines) {
  p.text("PAYER'S name, street address, city or town, state or province, country, ZIP", 40, 750, 6);
  p.text('or foreign postal code, and telephone no.', 40, 743, 6);
  lines.forEach((s, i) => p.text(s, 40, 730 - 12 * i, 10, f.mono));
}

async function int1099() {
  const { doc, f } = await newPdf('Form 1099-INT (sample, fake data)');
  const page = doc.addPage([612, 792]);
  const p = pen(page, f);
  await payerBlock(p, f, ['First Federal Credit Union', '100 Lakeside Drive', 'Anytown, IL 12345', '(555) 555-0100']);
  p.text('OMB No. 1545-0112', 330, 750, 7);
  p.text('Form 1099-INT', 330, 736, 12, f.bold);
  p.text('(Rev. January 2024)', 330, 724, 7);
  p.text('For calendar year 2025', 330, 714, 7);
  p.text('Interest Income', 470, 736, 12, f.bold);
  p.text("PAYER'S TIN", 40, 672, 6);
  p.text('12-3456789', 40, 660, 10, f.mono);
  p.text("RECIPIENT'S TIN", 200, 672, 6);
  p.text('XXX-XX-1234', 200, 660, 10, f.mono);
  p.text("RECIPIENT'S name", 40, 644, 6);
  p.text('Pat Q. Sample', 40, 632, 10, f.mono);

  const rows = [
    ['1 Interest income', '3,234.56'],
    ['2 Early withdrawal penalty', '265.44'],
    ['3 Interest on U.S. Savings Bonds and Treas. obligations', '0.00'],
    ['4 Federal income tax withheld', '0.00'],
  ];
  rows.forEach(([caption, value], i) => {
    const y = 600 - 24 * i;
    p.text(caption, 40, y, 9);
    p.text('$', 330, y, 10);
    p.text(value, 340, y, 10, f.monoBold);
    p.rule(36, y - 8, 576, y - 8);
  });
  p.text('Account number (see instructions)', 40, 500, 9);
  p.text('0012345678', 340, 500, 10, f.mono);
  p.text('Form 1099-INT (Rev. 1-2024)    www.irs.gov/Form1099INT    Copy B For Recipient', 40, 470, 7);
  await save(doc, '1099-INT.pdf');
}

// ---------- 1099-DIV: box captions above values ----------

async function div1099() {
  const { doc, f } = await newPdf('Form 1099-DIV (sample, fake data)');
  const page = doc.addPage([612, 792]);
  const p = pen(page, f);
  await payerBlock(p, f, ['Schwab Brokerage', 'PO Box 900', 'Anytown, IL 12345']);
  p.text('OMB No. 1545-0110', 330, 750, 7);
  p.text('Form 1099-DIV', 330, 736, 12, f.bold);
  p.text('(Rev. January 2024)', 330, 724, 7);
  p.text('For calendar year 2025', 330, 714, 7);
  p.text('Dividends and Distributions', 450, 736, 11, f.bold);

  p.text("PAYER'S TIN", 40, 690, 6);
  p.text('12-3456789', 40, 676, 10, f.mono);
  p.text("RECIPIENT'S name", 40, 660, 6);
  p.text('Pat Q. Sample', 40, 646, 10, f.mono);
  p.text('Street address (including apt. no.)', 40, 630, 6);
  p.text('200 Oak Avenue', 40, 616, 10, f.mono);

  const money = (value, x, y) => {
    p.text('$', x, y, 10);
    if (value) p.text(value, x + 15, y, 10, f.mono);
  };
  p.box(326, 670, 250, 30);
  p.text('1a  Total ordinary dividends', 330, 690, 6.5);
  money('2,000.00', 330, 676);
  p.box(326, 640, 250, 30);
  p.text('1b  Qualified dividends', 330, 660, 6.5);
  money('1,500.00', 330, 646);
  p.box(326, 610, 125, 30);
  p.box(451, 610, 125, 30);
  p.text('2a  Total capital gain distr.', 330, 630, 6.5);
  money('350.00', 330, 616);
  p.text('2b  Unrecap. Sec. 1250 gain', 455, 630, 6.5);
  money('', 455, 616);
  p.text('Form 1099-DIV (Rev. 1-2024)    www.irs.gov/Form1099DIV', 40, 560, 7);
  await save(doc, '1099-DIV.pdf');
}

// ---------- 1040 draft: two pages, whole dollars, leader dots ----------

async function form1040() {
  const { doc, f } = await newPdf('Form 1040 draft (sample, fake data)');
  const num = (p, s, x, y) => p.text(s, x, y, 8, f.bold);

  const one = doc.addPage([612, 792]);
  let p = pen(one, f);
  p.text('Form', 36, 742, 8);
  p.text('1040', 58, 742, 18, f.bold);
  p.text('Department of the Treasury—Internal Revenue Service', 112, 752, 7);
  p.text('U.S. Individual Income Tax Return', 112, 740, 11, f.bold);
  p.text('2025', 330, 742, 18, f.bold);
  p.text('OMB No. 1545-0074', 390, 752, 7);
  p.text('IRS Use Only—Do not write or staple in this space.', 390, 742, 6);
  p.text('For the year Jan. 1–Dec. 31, 2025, or other tax year beginning', 36, 724, 7);
  p.text('Your first name and middle initial', 36, 708, 6);
  p.text('Last name', 220, 708, 6);
  p.text('Your social security number', 450, 708, 6);
  p.text('Pat Q.', 36, 696, 10, f.mono);
  p.text('Sample', 220, 696, 10, f.mono);
  p.text('000-00-0000', 450, 696, 10, f.mono);
  p.text('Home address (number and street). If you have a P.O. box, see instructions.', 36, 682, 6);
  p.text('Apt. no.', 330, 682, 6);
  p.text('200 Oak Avenue', 36, 670, 10, f.mono);
  p.text('City, town, or post office. If you have a foreign address, also complete spaces below.', 36, 656, 6);
  p.text('State', 330, 656, 6);
  p.text('ZIP code', 400, 656, 6);
  p.text('Anytown', 36, 644, 10, f.mono);
  p.text('IL', 330, 644, 10, f.mono);
  p.text('12345', 400, 644, 10, f.mono);

  p.text('Income', 36, 612, 9, f.bold);
  num(p, '1a', 36, 596);
  p.leaders('Wages, salaries, tips (Form(s) W-2, box 1)', 52, 446, 596);
  num(p, '1a', 452, 596);
  p.right('85,000', 570, 596);

  num(p, '2a', 36, 580);
  p.leaders('Tax-exempt interest', 52, 218, 580);
  num(p, '2a', 225, 580);
  p.right('410', 300, 580);
  num(p, 'b', 310, 580);
  p.leaders('Taxable interest', 318, 446, 580);
  num(p, '2b', 452, 580);
  p.right('3,235', 570, 580);

  num(p, '3a', 36, 564);
  p.leaders('Qualified dividends', 52, 218, 564);
  num(p, '3a', 225, 564);
  num(p, 'b', 310, 564);
  p.leaders('Ordinary dividends', 318, 446, 564);
  num(p, '3b', 452, 564);
  p.right('2,000', 570, 564);

  num(p, '9', 36, 548);
  p.leaders('Total income. Add lines 1z, 2b, 3b, 4b, 5b, 6b, 7, and 8', 52, 446, 548);
  num(p, '9', 452, 548);
  p.right('90,235', 570, 548);
  p.text('For Disclosure, Privacy Act, and Paperwork Reduction Act Notice, see separate instructions.', 36, 520, 6);
  p.text('Cat. No. 11320B', 400, 520, 6);
  p.text('Form 1040 (2025)', 500, 520, 7);

  const two = doc.addPage([612, 792]);
  p = pen(two, f);
  p.text('Form 1040 (2025)', 36, 760, 8);
  p.text('Page 2', 540, 760, 8);
  p.text('Tax and Credits', 36, 740, 9, f.bold);
  num(p, '24', 36, 720);
  p.leaders('Add lines 22 and 23. This is your total tax', 52, 446, 720);
  num(p, '24', 452, 720);
  p.right('11,874', 570, 720);
  p.text('Payments', 36, 700, 9, f.bold);
  num(p, '25', 36, 684);
  p.text('Federal income tax withheld from:', 52, 684, 8);
  num(p, 'a', 52, 670);
  p.leaders('Federal income tax withheld from Form(s) W-2', 60, 368, 670);
  num(p, '25a', 374, 670);
  p.right('9,120', 440, 670);
  num(p, 'b', 52, 656);
  p.leaders('Form(s) 1099', 60, 368, 656);
  num(p, '25b', 374, 656);
  num(p, 'd', 52, 642);
  p.leaders('Add lines 25a through 25c', 60, 446, 642);
  num(p, '25d', 452, 642);
  p.right('9,120', 570, 642);
  p.text('Sign Here', 36, 600, 9, f.bold);
  p.text('Your signature', 100, 600, 6);
  p.text('Date', 300, 600, 6);
  p.text('Your occupation', 380, 600, 6);
  p.text('Pat Q. Sample', 100, 588, 10, f.mono);
  p.text('04/15/2026', 300, 588, 10, f.mono);
  p.text('Engineer', 380, 588, 10, f.mono);
  p.text('Phone no.', 100, 572, 6);
  p.text('(555) 555-0100', 140, 572, 10, f.mono);
  await save(doc, '1040 draft.pdf');
}

// ---------- Schedule B ----------

async function scheduleB() {
  const { doc, f } = await newPdf('Schedule B (sample, fake data)');
  const page = doc.addPage([612, 792]);
  const p = pen(page, f);
  const num = (s, x, y) => p.text(s, x, y, 8, f.bold);
  p.text('SCHEDULE B', 36, 752, 11, f.bold);
  p.text('(Form 1040)', 36, 740, 8);
  p.text('Department of the Treasury', 36, 730, 6);
  p.text('Internal Revenue Service', 36, 723, 6);
  p.text('Interest and Ordinary Dividends', 180, 748, 13, f.bold);
  p.text('Attach to Form 1040 or 1040-SR.', 200, 734, 8);
  p.text('OMB No. 1545-0074', 470, 752, 7);
  p.text('2025', 480, 736, 16, f.bold);
  p.text('Attachment Sequence No. 08', 470, 724, 6);
  p.text('Name(s) shown on return', 36, 706, 6);
  p.text('Pat Q. Sample', 36, 694, 10, f.mono);
  p.text('Your social security number', 450, 706, 6);
  p.text('000-00-0000', 450, 694, 10, f.mono);

  p.text('Amount', 530, 676, 8, f.bold);
  p.text('Part I', 36, 664, 9, f.bold);
  num('1', 80, 664);
  p.text('List name of payer. If any interest is from a seller-financed mortgage and the', 95, 664);
  p.text('Interest', 36, 654, 9, f.bold);
  p.text('buyer used the property as a personal residence, see the instructions and list this', 95, 654);
  p.text("interest first. Also, show that buyer's social security number and address:", 95, 644);
  p.text('First Federal Credit Union', 95, 628, 10, f.mono);
  p.right('3,253', 570, 628);
  num('2', 80, 610);
  p.leaders('Add the amounts on line 1', 95, 446, 610);
  num('2', 452, 610);
  num('3', 80, 596);
  p.leaders('Excludable interest on series EE and I U.S. savings bonds issued after 1989', 95, 446, 596);
  num('3', 452, 596);
  num('4', 80, 582);
  p.leaders('Subtract line 3 from line 2. Enter the result here and on Form 1040, line 2b', 95, 446, 582);
  num('4', 452, 582);
  p.right('3,235', 570, 582);

  p.text('Part II', 36, 556, 9, f.bold);
  num('5', 80, 556);
  p.text('List name of payer:', 95, 556);
  p.text('Ordinary', 36, 546, 9, f.bold);
  p.text('Dividends', 36, 536, 9, f.bold);
  p.text('Vanguard', 95, 540, 10, f.mono);
  p.right('2,100', 570, 540);
  await save(doc, 'Schedule B.pdf');
}

// ---------- Scanned statement: images only, no text ----------

function png(width, height, pixel) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw.set([r, g, b], y * stride + 1 + x * 3);
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function scan() {
  const { doc } = await newPdf('Brokerage summary (scanned, fake data)');
  for (const seed of [1, 2]) {
    const image = await doc.embedPng(
      png(300, 390, (x, y) => {
        const paper = 238 - ((x * 7 + y * 13 + seed) % 7);
        const inkLine = y > 24 && y % 18 < 6 && x > 20 && x < 40 + ((y * 37 + seed * 53) % 230);
        const v = inkLine ? 70 : paper;
        return [v, v, Math.max(0, v - 6)];
      }),
    );
    doc.addPage([612, 792]).drawImage(image, { x: 36, y: 36, width: 540, height: 702 });
  }
  await save(doc, 'brokerage-summary.pdf');
}

// ---------- Password-protected PDF (pdf-lib can't encrypt, so this one is written by hand) ----------
// Standard security handler, revision 2 (40-bit RC4). User password "secret"; opening without it must fail.

function rc4(key, data) {
  const s = Uint8Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

function lockedPdf() {
  const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');
  const pad = (pw) => Buffer.concat([Buffer.from(pw, 'latin1'), PAD]).subarray(0, 32);
  const md5 = (...parts) => createHash('md5').update(Buffer.concat(parts)).digest();
  const id = md5(Buffer.from('number-finder locked fixture'));
  const P = -44;
  const pBytes = Buffer.alloc(4);
  pBytes.writeInt32LE(P);
  const O = rc4(md5(pad('owner-secret')).subarray(0, 5), pad('secret'));
  const key = md5(pad('secret'), O, pBytes, id).subarray(0, 5);
  const U = rc4(key, PAD);
  const objectKey = (num, gen) => md5(key, Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, gen & 255, (gen >> 8) & 255])).subarray(0, 10);

  const content = rc4(objectKey(4, 0), Buffer.from('BT /F1 12 Tf 72 700 Td (Total due 1,234.56) Tj ET', 'latin1'));
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'latin1'), content, Buffer.from('\nendstream', 'latin1')]),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Filter /Standard /V 1 /R 2 /Length 40 /P ${P} /O <${O.toString('hex')}> /U <${U.toString('hex')}> >>`,
  ];
  const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  let offset = parts[0].length;
  const offsets = [];
  objects.forEach((body, i) => {
    const chunk = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`, 'latin1'),
      Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'),
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
    offsets.push(offset);
    parts.push(chunk);
    offset += chunk.length;
  });
  const xref = [
    'xref',
    `0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 6 0 R /ID [<${id.toString('hex')}> <${id.toString('hex')}>] >>`,
    'startxref',
    String(offset),
    '%%EOF',
    '',
  ].join('\n');
  parts.push(Buffer.from(xref, 'latin1'));
  writeFileSync(join(OUT, 'locked.pdf'), Buffer.concat(parts));
  console.log('wrote fixtures/locked.pdf');
}

// ---------- Workpapers (Excel) ----------

async function workpapers() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Number finder fixtures (fake data)';
  wb.created = FIXED_DATE;
  wb.modified = FIXED_DATE;

  const interest = wb.addWorksheet('Interest');
  interest.getColumn('A').width = 28;
  interest.getColumn('B').width = 14;
  interest.getColumn('C').width = 16;
  interest.getColumn('D').width = 14;
  interest.getCell('A1').value = 'Interest income workpaper';
  interest.getCell('A2').value = 'Period end';
  interest.getCell('B2').value = new Date(Date.UTC(2025, 11, 31));
  interest.getCell('B2').numFmt = 'yyyy-mm-dd';
  interest.getCell('A4').value = 'Gross interest';
  interest.getCell('B4').value = 3500;
  interest.getCell('B4').numFmt = '#,##0.00';
  interest.getCell('A6').value = 'Early withdrawal penalty';
  interest.getCell('B6').value = 265.44;
  interest.getCell('B6').numFmt = '#,##0.00';
  interest.getCell('C9').value = 'Net interest';
  interest.getCell('D9').value = { formula: 'B4-B6', result: 3234.56 };
  interest.getCell('D9').numFmt = '#,##0.00';

  const dividends = wb.addWorksheet('Dividends');
  dividends.getColumn('A').width = 18;
  dividends.addRow(['Payer', 'Amount']);
  dividends.addRow(['Schwab', 2000]);
  dividends.addRow(['Vanguard', 100]);

  const summary = wb.addWorksheet('Summary');
  summary.getColumn('A').width = 20;
  summary.getColumn('B').width = 14;
  summary.getCell('A1').value = 'Summary';
  summary.getCell('A3').value = 'Total interest';
  summary.getCell('B3').value = { formula: 'Interest!D9', result: 3234.56 };
  summary.getCell('A4').value = 'Total dividends';
  summary.getCell('B4').value = { formula: 'SUM(Dividends!B2:B3)', result: 2100 };
  summary.getCell('A5').value = 'Adjustment';
  summary.getCell('B5').value = '(75.00)'; // money typed as text
  summary.getCell('A6').value = 'Total income';
  summary.getCell('B6').value = { formula: 'B3+B4', result: 5334.56 };
  summary.getCell('A8').value = 'Tax rate';
  summary.getCell('B8').value = 0.22;
  summary.getCell('B8').numFmt = '0%';

  writeFileSync(join(OUT, 'workpapers.xlsx'), Buffer.from(await wb.xlsx.writeBuffer()));
  console.log('wrote fixtures/workpapers.xlsx');
}

function donations() {
  const csv = [
    'Date,Charity,Amount',
    '2025-01-15,Red Cross,$250.00',
    '3/2/2025,Food Bank,125',
    '2025-06-30,Animal Shelter,"$1,045.50"',
    '12/20/2025,Library Fund,(20.00)',
    '',
  ].join('\n');
  writeFileSync(join(OUT, 'donations.csv'), csv);
  console.log('wrote fixtures/donations.csv');
}

await w2();
await int1099();
await div1099();
await form1040();
await scheduleB();
await scan();
lockedPdf();
await workpapers();
donations();
