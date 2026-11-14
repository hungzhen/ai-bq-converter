/**
 * Facts about the application shown on screen and checked by the tests.
 * Kept in one place so the screen and the tests can never disagree.
 */
export const APP_INFO = {
  name: 'AI BQ Converter',
  stage: 'Phase 2 — Stage 2H (pipeline and first interface)',
  /** How documents are interpreted. Phase 2 uses conventional rules only — no AI. */
  processingMode: 'Conventional rule-based processing — no AI in use',
  /** Pinned SheetJS Community Edition version (official CDN package). */
  sheetJsVersion: '0.20.3',
} as const;
