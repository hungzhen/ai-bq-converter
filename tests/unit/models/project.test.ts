/** Stage 2C — one project, several source files. SYNTHETIC — NOT REAL COST DATA. */
import { describe, expect, it } from 'vitest';
import {
  ProjectError,
  addRelationship,
  addSourceDocument,
  checkReferencesBelongToProject,
  createCsvReference,
  createPdfReference,
  createProject,
  createSourceDocument,
  createWorksheetReference,
  findDocument,
  findDuplicateContent,
  setProjectYear,
} from '../../../src/core/models/index.ts';
import { BQ_CSV, BQ_XLSX, CLAIM_PDF, SYNTHETIC_PROJECT_ID, WORKING_XLS, syntheticProject } from '../../helpers/synthetic/models.ts';

describe('a project with multiple source files', () => {
  const project = syntheticProject();

  it('holds Excel, old Excel, CSV and PDF files of different document types', () => {
    expect(project.documents.map((d) => [d.fileName, d.format, d.documentType])).toEqual([
      ['SYNTHETIC_BQ.xlsx', 'xlsx', 'standard_bq'],
      ['SYNTHETIC_WORKING_FILE.xls', 'xls', 'contractor_working_file'],
      ['SYNTHETIC_BILL_2.csv', 'csv', 'standard_bq'],
      ['SYNTHETIC_CLAIM_05.pdf', 'pdf', 'progress_claim'],
    ]);
  });

  it('finds each file by id', () => {
    expect(findDocument(project, 'doc-claim-pdf')?.fileName).toBe('SYNTHETIC_CLAIM_05.pdf');
    expect(findDocument(project, 'nope')).toBeUndefined();
  });

  it('accepts references into any of its files', () => {
    const refs = [
      createWorksheetReference(BQ_XLSX, { sheetName: 'Bill 1', sheetIndex: 0, rowNumber: 10, columnNumber: 4 }),
      createWorksheetReference(WORKING_XLS, { sheetName: 'Sheet1', sheetIndex: 0, rowNumber: 3 }),
      createCsvReference(BQ_CSV, { rowNumber: 7, columnNumber: 2 }),
      createPdfReference(CLAIM_PDF, { pageNumber: 2, lineNumber: 5, extraction: 'ocr', ocrConfidence: 91 }),
    ];
    expect(checkReferencesBelongToProject(project, refs)).toEqual([]);
  });

  it('reports a reference to a file that is not in the project', () => {
    const stranger = createSourceDocument({ ...BQ_XLSX, id: 'doc-stranger', fileName: 'OTHER.xlsx', sha256: 'e'.repeat(64) });
    const ref = createWorksheetReference(stranger, { sheetName: 'Bill 1', sheetIndex: 0, rowNumber: 1 });
    expect(checkReferencesBelongToProject(project, [ref])).toEqual(['Reference to unknown document "doc-stranger" (OTHER.xlsx).']);
  });

  it('reports a reference whose file name or type does not match the project\'s record', () => {
    const renamed = createSourceDocument({ ...BQ_XLSX, fileName: 'RENAMED.xlsx', documentType: 'summary_only' });
    const ref = createWorksheetReference(renamed, { sheetName: 'Bill 1', sheetIndex: 0, rowNumber: 1 });
    const problems = checkReferencesBelongToProject(project, [ref]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('RENAMED.xlsx');
  });

  it('refuses the same document id twice, and a document of another project', () => {
    expect(() => addSourceDocument(project, BQ_XLSX)).toThrow(ProjectError);
    const foreign = createSourceDocument({ ...BQ_XLSX, id: 'doc-foreign', projectId: 'other-project' });
    expect(() => addSourceDocument(project, foreign)).toThrow(ProjectError);
  });

  it('reports the same file uploaded twice (same fingerprint) without merging it', () => {
    const again = createSourceDocument({ ...BQ_XLSX, id: 'doc-bq-again', fileName: 'SYNTHETIC_BQ (1).xlsx' });
    const groups = findDuplicateContent(addSourceDocument(project, again));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.map((d) => d.id)).toEqual(['doc-bq-xlsx', 'doc-bq-again']);
  });

  it('records relationships between files, e.g. the claim is against the BQ', () => {
    const related = addRelationship(project, {
      id: 'rel-1', fromDocumentId: CLAIM_PDF.id, toDocumentId: BQ_XLSX.id, kind: 'claim_against', status: 'confirmed',
    });
    expect(related.relationships).toHaveLength(1);
    expect(() => addRelationship(project, { id: 'r', fromDocumentId: 'nope', toDocumentId: BQ_XLSX.id, kind: 'supersedes', status: 'suggested' })).toThrow(ProjectError);
  });

  it('adding a file returns a NEW project and leaves the old one unchanged', () => {
    const before = createProject({ id: SYNTHETIC_PROJECT_ID, name: 'P' });
    const after = addSourceDocument(before, BQ_XLSX);
    expect(before.documents).toHaveLength(0);
    expect(after.documents).toHaveLength(1);
    expect(Object.isFrozen(after.documents)).toBe(true);
  });
});

describe('project year', () => {
  it('is null until a person enters it — never assumed', () => {
    expect(createProject({ id: 'p', name: 'P' }).projectYear).toBeNull();
  });

  it('must use the FullBQItem format "YYYY Q#"', () => {
    expect(setProjectYear(createProject({ id: 'p', name: 'P' }), '2000 Q4').projectYear).toBe('2000 Q4');
    for (const bad of ['2000', 'Q1 2000', '2000 Q5', '2000-Q1', '']) {
      expect(() => createProject({ id: 'p', name: 'P', projectYear: bad })).toThrow(ProjectError);
    }
  });
});
