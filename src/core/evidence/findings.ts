/**
 * Findings produced by the evidence verifier.
 *
 * Severity:
 *   info      for information (e.g. "entered by a person, not read from the document")
 *   warning   questionable — a person must look at it; approval needs a note acknowledging it
 *   blocking  wrong or untraceable — cannot be approved at all until fixed at the source
 *
 * The verifier only REPORTS. It never corrects a value, never fills one in, and never
 * marks anything as approved or verified.
 */
import type { CellRef } from '../models/extraction.ts';
import type { SourceReference } from '../models/source.ts';

export type FindingSeverity = 'info' | 'warning' | 'blocking';

export type FindingCode =
  // traceability
  | 'INCONSISTENT_EVIDENCE'
  | 'SOURCE_NOT_IN_PROJECT'
  | 'WRONG_PROJECT'
  | 'WRONG_DOCUMENT'
  | 'SOURCE_CELL_NOT_FOUND'
  | 'SOURCE_ROW_NOT_FOUND'
  | 'RAW_TEXT_ALTERED'
  | 'PARSED_VALUE_MISMATCH'
  | 'CONFLICTING_EVIDENCE'
  | 'INTEGRITY_PROBLEM'
  | 'APPROVED_WITH_BLOCKING_ISSUES'
  | 'LINKED_BQ_ROW_NOT_FOUND'
  // questionable values
  | 'MISSING_VALUE'
  | 'UNPARSEABLE_VALUE'
  | 'AMBIGUOUS_VALUE'
  | 'NEGATIVE_VALUE'
  | 'LOW_OCR_CONFIDENCE'
  | 'OCR_CONFIDENCE_UNKNOWN'
  | 'DERIVED_VALUE_NEEDS_REVIEW'
  | 'REJECTED_EVIDENCE'
  // for information
  | 'BLANK_VALUE'
  | 'NOT_STATED'
  | 'SPECIAL_MARKER'
  | 'USER_ENTERED'
  | 'COMBINED_VALUE'
  // interpretations (provider answers)
  | 'NOT_A_PROPOSAL'
  | 'NO_EVIDENCE'
  | 'CITED_TABLE_NOT_FOUND'
  | 'CITED_DOCUMENT_NOT_IN_PROJECT'
  | 'CITED_CELL_NOT_FOUND'
  | 'EVIDENCE_DOES_NOT_COVER_DECISION'
  | 'QUOTE_MISMATCH'
  | 'QUOTE_SPACING_DIFFERS'
  | 'QUOTE_COUNT_MISMATCH'
  | 'UNEXPECTED_FIELD'
  | 'INVALID_DECISION'
  | 'LABEL_LOOKS_LIKE_FIGURE'
  | 'INVALID_CONFIDENCE'
  | 'LOW_CONFIDENCE'
  | 'NO_REASONING'
  | 'PROVIDER_MISMATCH'
  | 'CANNOT_CHECK'
  | 'AI_PROPOSAL';

export interface Finding {
  readonly code: FindingCode;
  readonly severity: FindingSeverity;
  readonly message: string;
  readonly field?: string;
  readonly source?: SourceReference;
  readonly cell?: CellRef;
  /** Possible readings of an ambiguous value, for a person to choose from. */
  readonly candidates?: readonly { readonly value: number; readonly meaning: string }[];
}

export interface VerificationReport {
  /** What was verified, e.g. "row bq-row-10" or "interpretation columnRole". */
  readonly subject: string;
  /**
   * An exact text copy of what was verified. A report is only valid for that exact thing:
   * if the thing changes afterwards, the report no longer matches (see proposals.ts).
   */
  readonly subjectKey: string;
  /** True when there is no blocking finding. Warnings still need a person's attention. */
  readonly ok: boolean;
  readonly findings: readonly Finding[];
}

export const blockingFindings = (r: VerificationReport) => r.findings.filter((f) => f.severity === 'blocking');
export const warningFindings = (r: VerificationReport) => r.findings.filter((f) => f.severity === 'warning');

/** Stable text form of a value (object keys sorted), used as `subjectKey`. */
export function stableKey(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

export function makeReport(subject: string, subjectValue: unknown, findings: readonly Finding[]): VerificationReport {
  return Object.freeze({
    subject,
    subjectKey: stableKey(subjectValue),
    ok: !findings.some((f) => f.severity === 'blocking'),
    findings: Object.freeze([...findings]),
  });
}
