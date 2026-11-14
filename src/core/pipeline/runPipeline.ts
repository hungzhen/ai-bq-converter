/**
 * THE PIPELINE — one uploaded spreadsheet, in this order:
 *
 *   1 file selection → 2 format detection → 3 spreadsheet extraction → 4 source references
 *   → 5 rule-based interpretation → 6 evidence verification → 7 proposals → (8 a person reviews)
 *
 * Everything runs locally (in the browser or in tests). Nothing is sent anywhere.
 *
 * Each stage records its outcome. If a stage fails, the pipeline STOPS there and reports which
 * stage failed and why — it never carries on with incomplete or invalid data. (A single proposal
 * that fails verification is not a stage failure: it is kept, shown as "failed verification",
 * and can never be approved.)
 *
 * The uploaded bytes and the extracted tables are never changed. Proposals are created with
 * status "proposed"; nothing is approved here.
 */
import { createVerifiedProposals, type Proposal } from '../evidence/proposals.ts';
import { ExtractionError } from '../extraction/issues.ts';
import { detectSpreadsheetFormat } from '../extraction/formatDetect.ts';
import { type ExtractionOptions, type ExtractionResult, extractSpreadsheetFile } from '../extraction/extractSpreadsheet.ts';
import { type ConverterProject, addSourceDocument, checkReferencesBelongToProject, createProject } from '../models/project.ts';
import type { DecisionKind, Interpretation, InterpretationProvider } from '../../providers/types.ts';

export type StageName =
  | 'file_selection'
  | 'format_detection'
  | 'extraction'
  | 'source_references'
  | 'interpretation'
  | 'verification'
  | 'proposals';

export const STAGES: readonly { name: StageName; label: string }[] = [
  { name: 'file_selection', label: 'File selection' },
  { name: 'format_detection', label: 'Format detection' },
  { name: 'extraction', label: 'Spreadsheet extraction' },
  { name: 'source_references', label: 'Source references' },
  { name: 'interpretation', label: 'Rule-based interpretation' },
  { name: 'verification', label: 'Evidence verification' },
  { name: 'proposals', label: 'Proposal generation' },
];

export interface StageOutcome {
  readonly stage: StageName;
  readonly status: 'done' | 'failed' | 'not_run';
  readonly message: string;
}

export interface PipelineInput {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  /** Id for the uploaded document (generated when omitted). */
  readonly documentId?: string;
  readonly uploadedAt?: string;
}

export interface PipelineSuccess {
  readonly ok: true;
  readonly stages: readonly StageOutcome[];
  readonly project: ConverterProject;
  readonly extraction: ExtractionResult;
  readonly proposals: readonly Proposal[];
  /** Counts of proposals that passed / failed verification. */
  readonly verification: { readonly passed: number; readonly failed: number };
}

export interface PipelineFailure {
  readonly ok: false;
  readonly stages: readonly StageOutcome[];
  readonly failedStage: StageName;
  readonly message: string;
  /** e.g. "CSV_DELIMITER_AMBIGUOUS", when the failure has a code. */
  readonly code?: string;
}

export type PipelineResult = PipelineSuccess | PipelineFailure;

const newId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `doc-${Date.now()}`);

export async function runPipeline(input: PipelineInput, provider: InterpretationProvider, options: ExtractionOptions = {}): Promise<PipelineResult> {
  const stages: StageOutcome[] = [];
  const done = (stage: StageName, message: string) => stages.push({ stage, status: 'done', message });
  const fail = (stage: StageName, message: string, code?: string): PipelineFailure => {
    stages.push({ stage, status: 'failed', message });
    for (const s of STAGES) if (!stages.some((x) => x.stage === s.name)) stages.push({ stage: s.name, status: 'not_run', message: 'Not run because an earlier stage failed.' });
    return { ok: false, stages, failedStage: stage, message, ...(code ? { code } : {}) };
  };
  const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

  // 1. File selection
  if (!input.fileName.trim() || input.bytes.length === 0) {
    return fail('file_selection', input.bytes.length === 0 ? `"${input.fileName}" is empty (0 bytes).` : 'No file was selected.', input.bytes.length === 0 ? 'EMPTY_FILE' : undefined);
  }
  done('file_selection', `${input.fileName} (${input.bytes.length.toLocaleString('en')} bytes)`);

  // 2. Format detection
  try {
    const { format } = detectSpreadsheetFormat(input.bytes, input.fileName);
    done('format_detection', `Read as ${format.toUpperCase()}.`);
  } catch (e) {
    return fail('format_detection', errorText(e), e instanceof ExtractionError ? e.code : undefined);
  }

  // 3. Extraction (worksheets, cells, CSV)
  const documentId = input.documentId ?? newId();
  let extraction: ExtractionResult;
  try {
    extraction = await extractSpreadsheetFile(
      { bytes: input.bytes, fileName: input.fileName, projectId: 'local-review', documentId, uploadedAt: input.uploadedAt ?? new Date().toISOString(), uploadedBy: null, organizationId: null },
      options,
    );
  } catch (e) {
    return fail('extraction', errorText(e), e instanceof ExtractionError ? e.code : undefined);
  }
  const errors = extraction.issues.filter((i) => i.severity === 'error').length;
  done('extraction', `${extraction.tables.length} table(s), ${extraction.issues.length} note(s)${errors ? `, ${errors} error(s) — see the extraction issues` : ''}.`);

  // 4. Source references — every row and cell must point into this document
  const project = addSourceDocument(createProject({ id: 'local-review', name: 'Local review (not saved)' }), extraction.document);
  const refs = extraction.tables.flatMap((t) => t.rows.flatMap((r) => [r.source, ...r.cells.map((c) => c.source)]));
  const refProblems = checkReferencesBelongToProject(project, refs);
  if (refProblems.length) return fail('source_references', `${refProblems.length} source reference(s) are invalid: ${refProblems[0]}`);
  done('source_references', `${refs.length.toLocaleString('en')} source references checked.`);

  // 5. Interpretation (proposals only)
  const ctx = { project, document: extraction.document, tables: extraction.tables };
  let answers: Interpretation<DecisionKind>[];
  try {
    const documentType = await provider.classifyDocument(ctx);
    const regions = await provider.detectTableRegions(ctx);
    const columns = await provider.mapColumns(ctx, regions.map((r) => r.value));
    const rows = await provider.classifyRows(ctx, columns.map((c) => c.value), regions.map((r) => r.value));
    const hierarchy = await provider.interpretHierarchy(ctx, rows.map((r) => r.value));
    const suggestions = await provider.suggestClassifications(ctx, rows.map((r) => r.value));
    answers = [...documentType, ...regions, ...columns, ...rows, ...hierarchy, ...suggestions];
  } catch (e) {
    return fail('interpretation', `The interpretation provider failed: ${errorText(e)}`);
  }
  done('interpretation', `${answers.length} proposal(s) from ${provider.info.displayLabel}.`);

  // 6 + 7. Verification and proposals — every answer is verified; none is approved
  let proposals: Proposal[];
  try {
    proposals = createVerifiedProposals('p', answers, { project, tables: extraction.tables, documentId: extraction.document.id, provider: provider.info });
  } catch (e) {
    return fail('verification', `Evidence verification could not be completed: ${errorText(e)}`);
  }
  const failed = proposals.filter((p) => !p.verification.ok).length;
  done('verification', failed ? `${proposals.length - failed} passed; ${failed} FAILED verification (shown, can never be approved).` : `All ${proposals.length} passed.`);
  done('proposals', `${proposals.length} proposal(s) awaiting review. None approved.`);

  return { ok: true, stages, project, extraction, proposals, verification: { passed: proposals.length - failed, failed } };
}
