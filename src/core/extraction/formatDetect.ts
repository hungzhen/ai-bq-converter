/**
 * Decides how a file is read, from its NAME and its CONTENT (first bytes).
 *
 * Only .xlsx, .xls and .csv names are accepted. The content then decides:
 *   - ZIP container ("PK")              → Excel 2007+ (.xlsx)
 *   - OLE compound file (D0 CF 11 E0)   → Excel 97–2003 (.xls) — or a password-protected workbook
 *   - plain text                        → CSV (only for a .csv name)
 * This check is needed because the spreadsheet library will otherwise "read" almost anything
 * (random bytes, a web page) as if it were a sheet.
 *
 * An .xls name with .xlsx content (or the reverse) is read by its content, with a warning.
 * A web page or XML file saved with an Excel name, a very old Excel 2–4 file, or binary content
 * with a .csv name is refused with a clear message.
 */
import { ExtractionError, type ExtractionIssue } from './issues.ts';

export type SpreadsheetFormat = 'xlsx' | 'xls' | 'csv';

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const startsWith = (bytes: Uint8Array, magic: readonly number[]) => magic.every((b, i) => bytes[i] === b);

export function extensionOf(fileName: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(fileName.trim());
  return match ? match[1]!.toLowerCase() : '';
}

/** Looks at the start of the file, skipping a text BOM and spaces, to recognise HTML / XML. */
function looksLikeMarkup(bytes: Uint8Array): boolean {
  let i = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (i < bytes.length && i < 1024 && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
  return bytes[i] === 0x3c; // "<"
}

/** Excel 2.x – 4.0 files start directly with a BIFF BOF record (09 00 / 09 02 / 09 04). */
const looksLikeOldBiff = (bytes: Uint8Array) => bytes[0] === 0x09 && (bytes[1] === 0x00 || bytes[1] === 0x02 || bytes[1] === 0x04);

export function detectSpreadsheetFormat(bytes: Uint8Array, fileName: string): { format: SpreadsheetFormat; issues: ExtractionIssue[] } {
  const ext = extensionOf(fileName);
  if (ext !== 'xlsx' && ext !== 'xls' && ext !== 'csv') {
    throw new ExtractionError('UNSUPPORTED_FORMAT', `"${fileName}" is not supported. Only .xlsx, .xls and .csv files can be read in this stage.`);
  }
  if (bytes.length === 0) throw new ExtractionError('EMPTY_FILE', `"${fileName}" is empty (0 bytes).`);

  const isZip = startsWith(bytes, ZIP);
  const isCfb = startsWith(bytes, CFB);
  const issues: ExtractionIssue[] = [];

  if (ext === 'csv') {
    if (isZip || isCfb) {
      throw new ExtractionError('FORMAT_MISMATCH', `"${fileName}" is named .csv but contains an Excel workbook. Rename it to .xlsx or .xls, or export it as CSV again.`);
    }
    return { format: 'csv', issues };
  }

  if (isZip || isCfb) {
    const format: SpreadsheetFormat = isZip ? 'xlsx' : 'xls';
    if (format !== ext) {
      issues.push({
        code: 'EXTENSION_MISMATCH',
        severity: 'warning',
        message: `"${fileName}" is named .${ext} but its content is ${format === 'xlsx' ? 'an Excel 2007+ (.xlsx)' : 'an Excel 97–2003 (.xls) or protected'} workbook. It is read by its content.`,
      });
    }
    return { format, issues };
  }

  if (looksLikeMarkup(bytes)) {
    throw new ExtractionError('UNSUPPORTED_FORMAT', `"${fileName}" is a web page or XML file saved with an Excel name, not a real Excel workbook. Open it in Excel and save it as .xlsx.`);
  }
  if (looksLikeOldBiff(bytes)) {
    throw new ExtractionError('UNSUPPORTED_FORMAT', `"${fileName}" is a very old Excel (2.x–4.0) file. Open it in Excel and save it as .xlsx.`);
  }
  throw new ExtractionError('CORRUPTED_FILE', `"${fileName}" is not a valid Excel workbook (its content is not a recognised Excel file).`);
}
