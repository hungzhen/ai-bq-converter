/**
 * Evidence verifier (Stage 2E).
 *   findings.ts              finding codes, severities, reports
 *   verifyEvidence.ts        FieldEvidence, StagedBQRow and claim-line verification
 *   verifyInterpretation.ts  provider answers (rule-based now, AI later)
 *   proposals.ts             answers stay proposals until a person approves them
 */
export * from './findings.ts';
export * from './verifyEvidence.ts';
export * from './verifyInterpretation.ts';
export * from './proposals.ts';
export { BQ_ROW_CLASSES_FOR_CHECKS } from './rowClasses.ts';
