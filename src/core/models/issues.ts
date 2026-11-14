/**
 * ISSUES (warnings) attached to BQ rows and claim records.
 *
 * Severity:
 *   info      for information only
 *   warning   should be reviewed
 *   blocking  must be resolved by a person before the row can be approved or exported
 *
 * Resolving an issue records WHO resolved it, WHEN and WHY. It never changes the value
 * the issue is about (e.g. a negative amount stays negative).
 */
import type { SourceReference } from './source.ts';

export type IssueSeverity = 'info' | 'warning' | 'blocking';

export type IssueCode =
  | 'REQUIRED_FIELD_NOT_IN_SOURCE' // a required FullBQItem field has no value in the document
  | 'PROJECT_YEAR_NOT_ENTERED' // the project year must be entered by a person
  | 'NEGATIVE_VALUE' // a negative figure (kept as it is; blocks export until resolved — D-004)
  | 'UNPARSEABLE_VALUE' // text that could not be understood
  | 'SOURCE_VALUE_MISSING' // a value that should be there could not be read
  | 'SPECIAL_VALUE' // a marker such as "Incl." instead of a figure
  | 'CLAIM_ARITHMETIC_MISMATCH' // previous + current ≠ cumulative in a claim
  | 'CLAIM_NOT_LINKED' // a claim line not (yet) linked to a BQ row
  | 'CLAIM_CONTRACT_FIGURE_DIFFERS'; // a contract figure shown in a claim differs from the BQ

export interface IssueResolution {
  readonly by: string;
  readonly at: string;
  readonly note: string;
}

export interface ValidationIssue {
  readonly id: string;
  readonly code: IssueCode;
  readonly severity: IssueSeverity;
  readonly message: string;
  readonly field?: string;
  readonly sources: readonly SourceReference[];
  readonly resolution?: IssueResolution;
}

export const isUnresolvedBlocking = (issue: ValidationIssue): boolean =>
  issue.severity === 'blocking' && issue.resolution === undefined;
