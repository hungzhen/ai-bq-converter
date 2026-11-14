/**
 * CSV EXTRACTION — reads a CSV file into ONE ExtractedTable, keeping every field as the exact text
 * in the file. (CSV is deliberately NOT read through the spreadsheet library, which would turn
 * text such as "1,250.00" or "01/02/2000" into numbers or dates.)
 *
 * Supported:
 *   - UTF-8, with or without a BOM; UTF-16 with a BOM (Excel "Unicode text");
 *     other encodings (e.g. Windows-1252) only when chosen explicitly;
 *   - comma, semicolon, tab and | delimiters (detected, or chosen explicitly);
 *   - quoted fields, delimiters and line breaks inside quotes, "" for a quote inside a quoted field;
 *   - empty fields (kept as present-but-empty cells) and short rows (missing cells are absent);
 *   - \r\n, \n and \r line endings; blank lines kept as empty rows.
 * When the encoding or the delimiter cannot be determined reliably, or a quote is never closed,
 * an ExtractionError explains what to do instead of extracting something wrong.
 */
import { frozenCopy } from '../../../lib/immutable.ts';
import type { ExtractedCell, ExtractedRow, ExtractedTable } from '../../models/extraction.ts';
import { type DocumentIdentity, createCsvReference } from '../../models/source.ts';
import { ExtractionError, type ExtractionIssue } from '../issues.ts';

export type CsvDelimiter = ',' | ';' | '\t' | '|';
export type CsvEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';

export const CSV_DELIMITERS: readonly CsvDelimiter[] = [',', ';', '\t', '|'];

export interface CsvOptions {
  readonly delimiter?: CsvDelimiter;
  readonly encoding?: CsvEncoding;
}

export interface CsvInfo {
  readonly encoding: CsvEncoding;
  readonly hadBom: boolean;
  readonly delimiter: CsvDelimiter;
  readonly delimiterSource: 'detected' | 'chosen';
  readonly lineEnding: 'CRLF' | 'LF' | 'CR' | 'mixed' | 'none';
  readonly recordCount: number;
  /** The most common number of fields per record. */
  readonly fieldCount: number;
}

const delimiterName = (d: CsvDelimiter) => ({ ',': 'comma', ';': 'semicolon', '\t': 'tab', '|': 'vertical bar' })[d];

// ---------------------------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------------------------

export function decodeCsvBytes(bytes: Uint8Array, fileName: string, chosen?: CsvEncoding): { text: string; encoding: CsvEncoding; hadBom: boolean } {
  const decode = (enc: string, data: Uint8Array) => new TextDecoder(enc, { fatal: true }).decode(data);
  try {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: decode('utf-8', bytes.subarray(3)), encoding: 'utf-8', hadBom: true };
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: decode('utf-16le', bytes.subarray(2)), encoding: 'utf-16le', hadBom: true };
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: decode('utf-16be', bytes.subarray(2)), encoding: 'utf-16be', hadBom: true };
  } catch {
    throw new ExtractionError('CSV_ENCODING_UNDETERMINED', `"${fileName}" starts with a text-encoding mark but its content does not match it. Export the CSV again as "CSV UTF-8".`);
  }
  if (chosen) {
    try {
      return { text: decode(chosen, bytes), encoding: chosen, hadBom: false };
    } catch {
      throw new ExtractionError('CSV_ENCODING_UNDETERMINED', `"${fileName}" cannot be read as ${chosen}.`);
    }
  }
  if (bytes.includes(0)) {
    throw new ExtractionError('CSV_ENCODING_UNDETERMINED', `"${fileName}" contains zero bytes, so it is probably UTF-16 without an encoding mark. Choose the encoding, or export it again as "CSV UTF-8".`);
  }
  try {
    return { text: decode('utf-8', bytes), encoding: 'utf-8', hadBom: false };
  } catch {
    throw new ExtractionError('CSV_ENCODING_UNDETERMINED', `"${fileName}" is not valid UTF-8, so its encoding cannot be determined reliably. Choose the encoding (e.g. Windows-1252), or export it again as "CSV UTF-8".`);
  }
}

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

export interface CsvRecord {
  /** 1-based record number. */
  readonly recordNumber: number;
  /** Physical line on which the record starts (1-based). */
  readonly lineNumber: number;
  /** Fields exactly as in the file (quotes removed, "" turned into "). Empty line → no fields. */
  readonly fields: readonly string[];
}

export interface ParsedCsv {
  readonly records: readonly CsvRecord[];
  readonly issues: readonly ExtractionIssue[];
  readonly lineEnding: CsvInfo['lineEnding'];
}

/** Parses CSV text with one delimiter. Throws CSV_UNTERMINATED_QUOTE when a quote is never closed. */
export function parseCsvText(text: string, delimiter: CsvDelimiter, fileName = 'the file'): ParsedCsv {
  const records: CsvRecord[] = [];
  const issues: ExtractionIssue[] = [];
  const endings = new Set<string>();

  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldStarted = false; // the current record has at least a delimiter or a character
  let quotedField = false;
  let afterClosingQuote = false;
  let line = 1;
  let recordLine = 1;
  let quoteOpenedOnLine = 1;

  const endField = () => {
    fields.push(field);
    field = '';
    quotedField = false;
    afterClosingQuote = false;
  };
  const endRecord = () => {
    if (fieldStarted || fields.length > 0 || field !== '') endField();
    records.push({ recordNumber: records.length + 1, lineNumber: recordLine, fields });
    fields = [];
    fieldStarted = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
          afterClosingQuote = true;
        }
      } else {
        if (ch === '\r' || ch === '\n') {
          if (ch === '\r' && text[i + 1] === '\n') {
            field += '\r\n';
            i++;
          } else field += ch;
          line++;
          continue;
        }
        field += ch;
      }
      continue;
    }

    if (ch === delimiter) {
      fieldStarted = true;
      endField();
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      const isCrlf = ch === '\r' && text[i + 1] === '\n';
      endings.add(isCrlf ? 'CRLF' : ch === '\r' ? 'CR' : 'LF');
      if (isCrlf) i++;
      endRecord();
      line++;
      recordLine = line;
      continue;
    }
    if (ch === '"' && field === '' && !quotedField && !afterClosingQuote) {
      inQuotes = true;
      quotedField = true;
      fieldStarted = true;
      quoteOpenedOnLine = line;
      continue;
    }
    if (afterClosingQuote) {
      issues.push({ code: 'CSV_TEXT_AFTER_QUOTE', severity: 'warning', rowNumber: records.length + 1, message: `Record ${records.length + 1} (line ${line}) has text after a closing quote; it is kept as written.` });
      afterClosingQuote = false;
    } else if (ch === '"') {
      issues.push({ code: 'CSV_STRAY_QUOTE', severity: 'warning', rowNumber: records.length + 1, message: `Record ${records.length + 1} (line ${line}) has a quote inside an unquoted field; it is kept as written.` });
    }
    field += ch;
    fieldStarted = true;
  }

  if (inQuotes) {
    throw new ExtractionError('CSV_UNTERMINATED_QUOTE', `In ${fileName}, a quote opened on line ${quoteOpenedOnLine} is never closed, so the file's structure is invalid.`);
  }
  if (fieldStarted || fields.length > 0 || field !== '') endRecord();

  const lineEnding: CsvInfo['lineEnding'] = endings.size === 0 ? 'none' : endings.size > 1 ? 'mixed' : ([...endings][0] as CsvInfo['lineEnding']);
  return { records, issues, lineEnding };
}

const modeOf = (counts: number[]): number => {
  const tally = new Map<number, number>();
  for (const c of counts) tally.set(c, (tally.get(c) ?? 0) + 1);
  return [...tally].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;
};

interface DelimiterScore {
  delimiter: CsvDelimiter;
  parsed: ParsedCsv;
  fieldCount: number;
  consistency: number;
}

function scoreDelimiter(text: string, delimiter: CsvDelimiter): DelimiterScore | null {
  let parsed: ParsedCsv;
  try {
    parsed = parseCsvText(text, delimiter);
  } catch {
    return null;
  }
  const counts = parsed.records.filter((r) => r.fields.length > 0).map((r) => r.fields.length);
  if (counts.length === 0) return null;
  const fieldCount = modeOf(counts);
  return { delimiter, parsed, fieldCount, consistency: counts.filter((c) => c === fieldCount).length / counts.length };
}

/** Required share of records having the usual field count for a delimiter to count as reliable. */
export const DELIMITER_CONSISTENCY = 0.9;

/** Picks the delimiter, or throws when it cannot be determined reliably. */
export function detectDelimiter(text: string, fileName: string): { score: DelimiterScore; issues: ExtractionIssue[] } {
  const scores = CSV_DELIMITERS.map((d) => scoreDelimiter(text, d)).filter((s): s is DelimiterScore => s !== null && s.fieldCount >= 2);
  const strong = scores.filter((s) => s.consistency >= DELIMITER_CONSISTENCY);

  if (strong.length === 1) return { score: strong[0]!, issues: [] };
  if (strong.length > 1 || (strong.length === 0 && scores.length > 1)) {
    const names = (strong.length ? strong : scores).map((s) => `${delimiterName(s.delimiter)} (${s.fieldCount} fields)`).join(', ');
    throw new ExtractionError('CSV_DELIMITER_AMBIGUOUS', `The delimiter of "${fileName}" is ambiguous: it could be ${names}. Choose the delimiter.`);
  }
  if (scores.length === 1) {
    const s = scores[0]!;
    return {
      score: s,
      issues: [{ code: 'CSV_INCONSISTENT_FIELD_COUNTS', severity: 'warning', message: `Only ${Math.round(s.consistency * 100)}% of the records of "${fileName}" have ${s.fieldCount} ${delimiterName(s.delimiter)}-separated fields. Check the extracted table.` }],
    };
  }
  throw new ExtractionError('CSV_DELIMITER_UNDETERMINED', `No delimiter (comma, semicolon, tab or |) could be found in "${fileName}". Choose the delimiter.`);
}

// ---------------------------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------------------------

export function extractCsv(bytes: Uint8Array, document: DocumentIdentity, options: CsvOptions = {}): { table: ExtractedTable; csv: CsvInfo; issues: ExtractionIssue[] } {
  const { text, encoding, hadBom } = decodeCsvBytes(bytes, document.fileName, options.encoding);
  if (text.trim() === '') throw new ExtractionError('EMPTY_FILE', `"${document.fileName}" contains no data.`);

  const issues: ExtractionIssue[] = [];
  let parsed: ParsedCsv;
  let delimiter: CsvDelimiter;
  let fieldCount: number;

  if (options.delimiter) {
    delimiter = options.delimiter;
    parsed = parseCsvText(text, delimiter, `"${document.fileName}"`);
    fieldCount = modeOf(parsed.records.filter((r) => r.fields.length > 0).map((r) => r.fields.length));
  } else {
    // Parse once to surface an unterminated quote as such, not as an unknown delimiter.
    parseCsvText(text, ',', `"${document.fileName}"`);
    const detected = detectDelimiter(text, document.fileName);
    issues.push(...detected.issues);
    delimiter = detected.score.delimiter;
    parsed = detected.score.parsed;
    fieldCount = detected.score.fieldCount;
  }
  issues.push(...parsed.issues);
  issues.push({ code: 'CSV_ENCODING', severity: 'info', message: `Read as ${encoding.toUpperCase()}${hadBom ? ' (with an encoding mark)' : ''}.` });
  issues.push({ code: 'CSV_DELIMITER', severity: 'info', message: `Fields are separated by ${delimiterName(delimiter)}s (${options.delimiter ? 'chosen' : 'detected'}).` });

  for (const r of parsed.records) {
    if (r.fields.length > 0 && r.fields.length !== fieldCount) {
      issues.push({ code: 'CSV_FIELD_COUNT_DIFFERS', severity: 'warning', rowNumber: r.recordNumber, message: `Row ${r.recordNumber} (line ${r.lineNumber}) has ${r.fields.length} fields; most rows have ${fieldCount}. Nothing has been moved or filled in.` });
    }
  }

  const rows: ExtractedRow[] = parsed.records.map((r) => ({
    rowIndex: r.recordNumber - 1,
    source: createCsvReference(document, { rowNumber: r.recordNumber, lineNumber: r.lineNumber }),
    cells: r.fields.map(
      (value, c): ExtractedCell => ({
        columnIndex: c,
        raw: value,
        displayText: null,
        source: createCsvReference(document, { rowNumber: r.recordNumber, columnNumber: c + 1, lineNumber: r.lineNumber }),
        cellType: 'text',
      }),
    ),
  }));

  const table: ExtractedTable = { id: `${document.id}:csv`, documentId: document.id, origin: { kind: 'csv' }, rows };
  const csv: CsvInfo = { encoding, hadBom, delimiter, delimiterSource: options.delimiter ? 'chosen' : 'detected', lineEnding: parsed.lineEnding, recordCount: parsed.records.length, fieldCount };
  return frozenCopy({ table, csv, issues });
}
