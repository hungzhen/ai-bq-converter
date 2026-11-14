/**
 * SYNTHETIC — NOT REAL COST DATA.
 *
 * Synthetic BQ layouts for the rule-based provider tests, built as real .xlsx files in memory and
 * read through the Stage 2F extractor. Descriptions are artificial; figures are round dummy numbers.
 */
import * as XLSX from 'xlsx';
import { type ExtractionResult } from '../../../src/core/extraction/index.ts';
import { addSourceDocument, createProject, type ConverterProject } from '../../../src/core/models/index.ts';
import { extract } from './spreadsheets.ts';

type Row = (string | number | null)[];

function sheet(rows: Row[], extra: (ws: XLSX.WorkSheet) => void = () => {}): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  extra(ws);
  return ws;
}

function workbookBytes(sheets: { name: string; ws: XLSX.WorkSheet; hidden?: boolean }[]): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, s.ws, s.name);
  wb.Workbook = { Sheets: sheets.map((s) => ({ Hidden: s.hidden ? 1 : 0 })) } as XLSX.WBProps;
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}

export const HEADER = ['No.', 'Description', 'Unit', 'Qty', 'Rate (RM)', 'Amount (RM)'];

/** Excel row number → table row index. */
export const R = (excelRow: number) => excelRow - 1;

/** Conventional BQ: cover sheet, Bill 2 (many row types) and Bill 3 (different heading layout). */
export function conventionalBq(): Uint8Array {
  const bill2: Row[] = [
    /* 1 */ ['BILL NO. 2 – SUBSTRUCTURE (SYNTHETIC — NOT REAL COST DATA)'],
    /* 2 */ [],
    /* 3 */ HEADER,
    /* 4 */ [null, 'EXCAVATION AND EARTHWORK'],
    /* 5 */ [null, 'Excavation in ordinary ground'],
    /* 6 */ ['A', 'SYNTHETIC excavation for pile caps, depth not exceeding 1.50m', 'm3', 10, 25.5, 255],
    /* 7 */ [null, 'and disposal of surplus material off site'],
    /* 8 */ ['B', 'SYNTHETIC hardcore filling under ground slab', 'm3', 5, null, null],
    /* 9 */ ['C', 'SYNTHETIC omission of temporary works', 'item', 1, -50, -50],
    /* 10 */ ['D', 'SYNTHETIC trimming of excavation sides', 'm2', 'Rate Only', 12, null],
    /* 11 */ ['E', 'SYNTHETIC dewatering', 'L.S.', null, null, 500],
    /* 12 */ [null, 'Note:'],
    /* 13 */ [null, 'All excavation shall be measured net. The contractor shall allow for keeping excavations free from water. Synthetic specification text for testing only.'],
    /* 14 */ ['F', 'SYNTHETIC concrete grade 30 in pile caps', 'm3', '-', null, 'Nil'],
    /* 15 */ [],
    /* 16 */ [null, 'Carried to Collection', null, null, null, 755],
    /* 17 */ [null, 'Page 2'],
    /* 18 */ HEADER,
    /* 19 */ ['G', 'SYNTHETIC excavation for pile caps, depth not exceeding 1.50m', 'm3', 10, 25.5, 255],
    /* 20 */ ['H', 'Provisional Sum for SYNTHETIC utility diversion', 'sum', null, null, 10000],
    /* 21 */ ['J', 'Prime Cost Sum for SYNTHETIC lift installation', 'sum', null, null, 20000],
    /* 22 */ [null, 'Allow for profit', '%', 5, null, null],
    /* 23 */ [null, 'Allow for attendance', '%', 2.5, null, null],
    /* 24 */ ['K', 'SYNTHETIC formwork to sides of pile caps', 'm2', 3, null, null],
    /* 25 */ ['L', 'SYNTHETIC provide temporary access as described'],
    /* 26 */ [null, 'Total carried to Summary', null, null, null, 30755],
  ];
  const bill3: Row[] = [
    /* 1 */ ['Description', 'Item', 'Unit', 'Quantity', 'Unit Rate', 'Total'],
    /* 2 */ ['BILL NO. 3 – SUPERSTRUCTURE (SYNTHETIC)'],
    /* 3 */ ['SYNTHETIC reinforced concrete grade 30 in columns', 'A', 'm3', 20, 300, 6000],
    /* 4 */ ['SYNTHETIC high tensile bar reinforcement', 'B', 'kg', 1000, 4, 4000],
    /* 5 */ ['SYNTHETIC brickwork in cement mortar', 'C', 'm2', 50, 40, 2000],
  ];
  return workbookBytes([
    { name: 'Cover', ws: sheet([['SYNTHETIC PROJECT — NOT REAL COST DATA'], [], ['Bills of Quantities (synthetic)']]) },
    { name: 'Bill 2', ws: sheet(bill2) },
    { name: 'Bill 3', ws: sheet(bill3) },
  ]);
}

/** Contractor working file: cost rate, markup, selling rate, supplier; hidden build-up sheet. */
export function workingFile(): Uint8Array {
  return workbookBytes([
    {
      name: 'Pricing',
      ws: sheet([
        ['Item', 'Description', 'Unit', 'Qty', 'Cost Rate', 'Markup %', 'Selling Rate', 'Amount', 'Supplier'],
        ['A', 'SYNTHETIC excavation to pile caps', 'm3', 10, 20, 0.1, 22, 220, 'SYNTHETIC SUPPLIER 1'],
        ['B', 'SYNTHETIC blinding concrete', 'm3', 2, 250, 0.1, 275, 550, 'SYNTHETIC SUPPLIER 2'],
      ], (ws) => {
        ws['F2']!.z = '0%';
        ws['F3']!.z = '0%';
      }),
    },
    {
      name: 'Rates build-up',
      hidden: true,
      ws: sheet([
        ['Description', 'Material', 'Labour', 'Plant', 'Cost Rate'],
        ['SYNTHETIC excavation to pile caps', 0, 12, 8, 20],
      ]),
    },
  ]);
}

/** Progress claim: two-row heading with merged group headings. */
export function progressClaim(): Uint8Array {
  return workbookBytes([
    {
      name: 'Claim 5',
      ws: sheet(
        [
          /* 1 */ ['SYNTHETIC PROGRESS CLAIM NO. 5 — NOT REAL COST DATA'],
          /* 2 */ [null, null, null, 'Contract', null, null, 'Previous Claim', null, 'This Claim', null, 'Cumulative', null, null],
          /* 3 */ ['Item', 'Description', 'Unit', 'Qty', 'Rate', 'Amount', 'Qty', 'Amount', 'Qty', 'Amount', 'Qty', 'Amount', '% Complete'],
          /* 4 */ ['A', 'SYNTHETIC excavation to pile caps', 'm3', 10, 25.5, 255, 2, 51, 3, 76.5, 5, 127.5, 0.5],
          /* 5 */ ['B', 'SYNTHETIC concrete to pile caps', 'm3', 5, 300, 1500, 0, 0, 1, 300, 1, 300, 0.2],
        ],
        (ws) => {
          ws['!merges'] = ['D2:F2', 'G2:H2', 'I2:J2', 'K2:L2'].map((r) => XLSX.utils.decode_range(r));
          ws['M4']!.z = '0%';
          ws['M5']!.z = '0%';
        },
      ),
    },
  ]);
}

/** Malay headings. */
export function malayHeadings(): Uint8Array {
  return workbookBytes([
    {
      name: 'Bil 1',
      ws: sheet([
        ['Bil', 'Perkara', 'Unit', 'Kuantiti', 'Kadar (RM)', 'Jumlah (RM)'],
        ['1', 'SYNTHETIC kerja tanah (ujian)', 'm3', 10, 20, 200],
        ['2', 'SYNTHETIC konkrit (ujian)', 'm3', 4, 250, 1000],
      ]),
    },
  ]);
}

/** Misleading headings: "Qty" holds long text; "Description" holds numbers. */
export function misleadingHeadings(): Uint8Array {
  return workbookBytes([
    {
      name: 'Odd',
      ws: sheet([
        ['No.', 'Description', 'Unit', 'Qty', 'Rate', 'Amount'],
        ['A', 125, 'm3', 'SYNTHETIC long description written in the qty column', 10, 1250],
        ['B', 40, 'm2', 'SYNTHETIC another long description in the wrong column', 5, 200],
        ['C', 12, 'nr', 'SYNTHETIC third long description in the wrong column', 3, 36],
      ]),
    },
  ]);
}

/** Several quantity columns (towers) sharing one rate. */
export function multipleQuantities(): Uint8Array {
  return workbookBytes([
    {
      name: 'Bill 4',
      ws: sheet([
        ['Item', 'Description', 'Unit', 'Qty Tower A', 'Qty Tower B', 'Total Qty', 'Rate', 'Amount'],
        ['A', 'SYNTHETIC ceramic floor tiling', 'm2', 100, 120, 220, 45, 9900],
        ['B', 'SYNTHETIC skim coat plaster to walls', 'm2', 300, 310, 610, 8, 4880],
      ]),
    },
  ]);
}

/** An incomplete document: a few lines of text and a number, no headings. */
export function incompleteDocument(): Uint8Array {
  return workbookBytes([{ name: 'Sheet1', ws: sheet([['SYNTHETIC NOTES ONLY'], ['Some synthetic remarks'], [12]]) }]);
}

export interface Loaded {
  readonly extraction: ExtractionResult;
  readonly project: ConverterProject;
  readonly ctx: { project: ConverterProject; document: ExtractionResult['document']; tables: ExtractionResult['tables'] };
}

/** Extracts a synthetic layout and wraps it in a project, ready for the provider. */
export async function load(bytes: Uint8Array, fileName: string): Promise<Loaded> {
  const extraction = await extract(bytes, fileName);
  const project = addSourceDocument(createProject({ id: 'proj-synthetic', name: 'SYNTHETIC', projectYear: '2000 Q1' }), extraction.document);
  return { extraction, project, ctx: { project, document: extraction.document, tables: extraction.tables } };
}
