/**
 * Compares the converter's read-only copy of costLibrary.ts with another version of the file
 * (for example the current Cost Library source) and describes the differences.
 *
 * This module only READS text and returns a report. It never writes or updates any file.
 * The command-line wrapper is scripts/check-cost-library-types.ts.
 */
import { createHash } from 'node:crypto';

/** Types the converter depends on most. A change to any of these is reported first. */
export const IMPORTANT_TYPES = [
  'FullBQItem',
  'ItemQuantityColumn',
  'BQRowType',
  'BQCostScopeType',
  'ColumnMappingConfig',
  'QuantityColumnMapping',
  'BQImportRowClassification',
  'ProjectSettings',
  'BillQuantityLayout',
  'BillQuantityPair',
  'OptionPrice',
  'PricingOptionsSetting',
] as const;

export interface ComparisonReport {
  identical: boolean;
  vendoredSha256: string;
  otherSha256: string;
  /** Top-level definitions present in the other version only. */
  added: string[];
  /** Top-level definitions present in the copy only. */
  removed: string[];
  /** Top-level definitions present in both whose text differs. */
  changed: string[];
  /** Important types (IMPORTANT_TYPES) among added / removed / changed. */
  importantAffected: string[];
  /** The files differ, but no individual definition does (e.g. line endings or spacing between definitions). */
  formattingOnly: boolean;
  /** `import('../utils/…').Name` references in the other version that the copy does not have (may need new stand-ins). */
  newExternalReferences: string[];
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

const DECLARATION_START =
  /^(?:export\s+)?(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|type|interface|class|enum)\s+([A-Za-z_$][\w$]*)/;

const isCommentLine = (line: string): boolean => /^\s*(\/\*\*?|\*|\*\/|\/\/)/.test(line);

/**
 * Splits a TypeScript source file into its top-level definitions, keyed by name.
 * Each definition includes the comment lines directly above it.
 * Text before the first definition is stored under "(file header)".
 */
export function extractTopLevelDeclarations(source: string): Map<string, string> {
  const lines = source.replace(/\r\n/g, '\n').split('\n');

  const starts: { line: number; name: string }[] = [];
  lines.forEach((line, index) => {
    const match = DECLARATION_START.exec(line);
    if (match?.[1]) starts.push({ line: index, name: match[1] });
  });

  // Move each start up to include the comment block directly above it.
  const blockStarts = starts.map(({ line, name }) => {
    let first = line;
    while (first > 0 && isCommentLine(lines[first - 1] ?? '')) first--;
    return { line: first, name };
  });

  const result = new Map<string, string>();
  const firstStart = blockStarts[0]?.line ?? lines.length;
  if (firstStart > 0) result.set('(file header)', lines.slice(0, firstStart).join('\n'));

  blockStarts.forEach((block, i) => {
    const end = blockStarts[i + 1]?.line ?? lines.length;
    let key = block.name;
    for (let n = 2; result.has(key); n++) key = `${block.name}#${n}`; // e.g. function overloads
    result.set(key, lines.slice(block.line, end).join('\n').trimEnd());
  });

  return result;
}

/** All `import('../utils/x').Name` references, as "../utils/x#Name". */
export function externalTypeReferences(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)\.([A-Za-z_$][\w$]*)/g)) {
    found.add(`${match[1]}#${match[2]}`);
  }
  return [...found].sort();
}

export function compareSources(vendoredText: string, otherText: string): ComparisonReport {
  const vendoredSha256 = sha256(vendoredText);
  const otherSha256 = sha256(otherText);

  const mine = extractTopLevelDeclarations(vendoredText);
  const theirs = extractTopLevelDeclarations(otherText);

  const added = [...theirs.keys()].filter((k) => !mine.has(k)).sort();
  const removed = [...mine.keys()].filter((k) => !theirs.has(k)).sort();
  const changed = [...mine.keys()].filter((k) => theirs.has(k) && theirs.get(k) !== mine.get(k)).sort();

  const touched = new Set([...added, ...removed, ...changed]);
  const importantAffected = IMPORTANT_TYPES.filter((t) => touched.has(t));

  const identical = vendoredSha256 === otherSha256;
  const myRefs = new Set(externalTypeReferences(vendoredText));

  return {
    identical,
    vendoredSha256,
    otherSha256,
    added,
    removed,
    changed,
    importantAffected,
    formattingOnly: !identical && touched.size === 0,
    newExternalReferences: externalTypeReferences(otherText).filter((r) => !myRefs.has(r)),
  };
}

/** Plain-English report for the terminal. */
export function formatReport(report: ComparisonReport, labels: { vendored: string; other: string }): string {
  const out: string[] = [];
  out.push(`Converter copy : ${labels.vendored}`);
  out.push(`               SHA-256 ${report.vendoredSha256}`);
  out.push(`Compared with  : ${labels.other}`);
  out.push(`               SHA-256 ${report.otherSha256}`);
  out.push('');

  if (report.identical) {
    out.push('RESULT: UNCHANGED — the Cost Library file is identical to the converter\'s copy.');
    return out.join('\n');
  }

  out.push('RESULT: CHANGED — the Cost Library file differs from the converter\'s copy.');
  out.push('The copy has NOT been updated. Refresh it only on the owner\'s instruction.');
  out.push('');

  if (report.importantAffected.length > 0) {
    out.push(`IMPORTANT types affected: ${report.importantAffected.join(', ')}`);
    out.push('');
  }
  if (report.formattingOnly) {
    out.push('Only formatting differs (e.g. line endings or spacing); no definition changed.');
  }
  if (report.changed.length) out.push(`Changed definitions (${report.changed.length}): ${report.changed.join(', ')}`);
  if (report.added.length) out.push(`New definitions (${report.added.length}): ${report.added.join(', ')}`);
  if (report.removed.length) out.push(`Removed definitions (${report.removed.length}): ${report.removed.join(', ')}`);
  if (report.newExternalReferences.length) {
    out.push(`New references to other Cost Library files (may need stand-ins): ${report.newExternalReferences.join(', ')}`);
  }
  return out.join('\n');
}
