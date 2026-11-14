/**
 * Helpers for the Stage 2L export tests. SYNTHETIC — NOT REAL COST DATA.
 */
import * as XLSX from 'xlsx';
import type { PipelineSuccess } from '../../src/core/pipeline/runPipeline.ts';
import type { SavedReview } from '../../src/core/review/index.ts';
import { decideDraftRow, resolveDraftIssue, viewRow } from '../../src/core/staging/index.ts';
import { AT, drafts } from './drafts.ts';

const BY = 'Synthetic Reviewer';

/**
 * Decides every draft row as a careful reviewer would: a row with a negative figure is excluded;
 * otherwise every resolvable blocking issue is confirmed with a note and the row is approved.
 */
export function decideAllRows(review: SavedReview, run: PipelineSuccess, only?: (tableName: string) => boolean): SavedReview {
  let r = review;
  for (const t of drafts(r, run).tables) {
    if (only && !only(t.name)) continue;
    for (const d of t.drafts) {
      const view = viewRow(d, r.draftRows?.find((s) => s.draftId === d.row.id) ?? null);
      if (view.blocking.some((b) => b.issue.code === 'NEGATIVE_VALUE')) {
        r = decideDraftRow(r, d, 'excluded', 'SYNTHETIC: negative credit, excluded from the upload.', AT, BY);
        continue;
      }
      for (const b of view.blocking) if (b.resolvable && !b.resolution) r = resolveDraftIssue(r, d, b.issue.id, `SYNTHETIC: confirmed (${b.issue.field ?? b.issue.code}).`, AT, BY);
      r = decideDraftRow(r, d, 'approved', 'SYNTHETIC: warnings acknowledged.', AT, BY);
    }
  }
  return r;
}

/** Reads a generated workbook with SheetJS directly (independent of the converter's extractor). */
export function sheetsOf(bytes: Uint8Array): XLSX.WorkBook {
  return XLSX.read(bytes, { type: 'array', cellFormula: true });
}
