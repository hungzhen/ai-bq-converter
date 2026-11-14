/** Shared imports for the extraction compatibility tests. */
export {
  type ExtractedCell,
  type ExtractedTable,
  type FieldEvidence,
  addSourceDocument,
  checkReferencesBelongToProject,
  createProject,
  cellValueForParsing,
  findCellBySource,
} from '../../../src/core/models/index.ts';
export type { ParseOrigin as ParseOriginLike } from '../../../src/core/parsing/index.ts';
