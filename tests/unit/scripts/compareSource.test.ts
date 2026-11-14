/**
 * Stage 2B — the comparison mechanism that detects changes to the Cost Library's costLibrary.ts.
 *
 * Every "changed" version here is made in memory (or in a temporary folder) from the converter's
 * copy. The real Cost Library is never read or changed by these tests.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  compareSources,
  extractTopLevelDeclarations,
  externalTypeReferences,
  formatReport,
  sha256,
} from '../../../scripts/cost-library-sync/compareSource.ts';

const root = resolve(import.meta.dirname, '../../..');
const copyPath = join(root, 'src/vendor/cost-library/types/costLibrary.ts');
const copy = readFileSync(copyPath, 'utf8');
const copyShaBefore = sha256(copy);

describe('splitting a file into definitions', () => {
  it('finds top-level definitions and keeps the comment directly above each one', () => {
    const source = [
      '// header comment',
      '',
      '/** About A. */',
      'export interface A {',
      '  x: number;',
      '}',
      '',
      'export type B = 1 | 2;',
      'const helper = 3;',
    ].join('\n');
    const blocks = extractTopLevelDeclarations(source);
    expect([...blocks.keys()]).toEqual(['(file header)', 'A', 'B', 'helper']);
    expect(blocks.get('A')).toContain('/** About A. */');
    expect(blocks.get('B')).toBe('export type B = 1 | 2;');
  });

  it('finds FullBQItem and the other important types in the real copy', () => {
    const names = [...extractTopLevelDeclarations(copy).keys()];
    for (const name of ['FullBQItem', 'ItemQuantityColumn', 'BQRowType', 'BQCostScopeType', 'ColumnMappingConfig', 'OptionPrice', 'ProjectSettings']) {
      expect(names).toContain(name);
    }
  });

  it('lists the references the copy makes to other Cost Library files', () => {
    expect(externalTypeReferences(copy)).toEqual([
      '../utils/benchmark#BenchmarkSettings',
      '../utils/billArea#AreaUnit',
      '../utils/billArea#BillAreaSource',
      '../utils/estimateBasis#BillKind',
      '../utils/projectDetails#ProjectDetails',
    ]);
  });
});

describe('comparing the copy with another version', () => {
  it('reports UNCHANGED for an identical file', () => {
    const report = compareSources(copy, copy);
    expect(report.identical).toBe(true);
    expect(report.added).toEqual([]);
    expect(report.removed).toEqual([]);
    expect(report.changed).toEqual([]);
    expect(formatReport(report, { vendored: 'copy', other: 'other' })).toContain('RESULT: UNCHANGED');
  });

  it('detects a new field in FullBQItem and flags it as an IMPORTANT type', () => {
    const other = copy.replace('  quantity: number;\n  \n', '  quantity: number;\n  quantityStatus?: string;\n  \n');
    expect(other).not.toBe(copy); // the edit really happened
    const report = compareSources(copy, other);
    expect(report.identical).toBe(false);
    expect(report.changed).toEqual(['FullBQItem']);
    expect(report.importantAffected).toEqual(['FullBQItem']);
    const text = formatReport(report, { vendored: 'copy', other: 'other' });
    expect(text).toContain('RESULT: CHANGED');
    expect(text).toContain('IMPORTANT types affected: FullBQItem');
    expect(text).toContain('has NOT been updated');
  });

  it('detects a new value in BQRowType', () => {
    const other = copy.replace("  | 'project_settings'\n", "  | 'project_settings'\n  | 'claim_line'\n");
    const report = compareSources(copy, other);
    expect(report.changed).toEqual(['BQRowType']);
    expect(report.importantAffected).toEqual(['BQRowType']);
  });

  it('detects added and removed definitions', () => {
    const added = compareSources(copy, `${copy}\nexport type SyntheticNewType = 'x';\n`);
    expect(added.added).toEqual(['SyntheticNewType']);

    const removed = compareSources(copy, copy.replace("export type ReliabilityRating = 'High' | 'Medium' | 'Low';\n", ''));
    expect(removed.removed).toEqual(['ReliabilityRating']);
    expect(removed.importantAffected).toEqual([]);
  });

  it('reports line-ending-only differences as formatting only', () => {
    const report = compareSources(copy, copy.replace(/\n/g, '\r\n'));
    expect(report.identical).toBe(false);
    expect(report.formattingOnly).toBe(true);
  });

  it('reports new references to other Cost Library files (which would need stand-ins)', () => {
    const other = copy.replace(
      '  /** Server-managed version',
      "  synthetic?: import('../utils/newModule').NewThing;\n  /** Server-managed version",
    );
    const report = compareSources(copy, other);
    expect(report.newExternalReferences).toEqual(['../utils/newModule#NewThing']);
    expect(report.changed).toContain('FullBQItem');
  });

  it('never changes the converter\'s copy', () => {
    compareSources(copy, copy.toUpperCase());
    expect(sha256(readFileSync(copyPath, 'utf8'))).toBe(copyShaBefore);
  });
});

describe('the npm run check:cost-library command', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'cl-compare-'));
  afterAll(() => rmSync(workDir, { recursive: true, force: true }));

  const runCheck = (...args: string[]) =>
    spawnSync(process.execPath, [join(root, 'scripts/check-cost-library-types.ts'), ...args], { encoding: 'utf8' });

  it('exits 0 and says UNCHANGED for an identical file', () => {
    const same = join(workDir, 'same.ts');
    writeFileSync(same, copy);
    const result = runCheck(same);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('RESULT: UNCHANGED');
  });

  it('accepts a Cost Library folder and finds src/types/costLibrary.ts inside it', () => {
    const folder = join(workDir, 'checkout');
    const typesDir = join(folder, 'src/types');
    spawnSync('mkdir', ['-p', typesDir]);
    writeFileSync(join(typesDir, 'costLibrary.ts'), copy);
    const result = runCheck(folder);
    expect(result.status).toBe(0);
  });

  it('exits 1 and names FullBQItem when the field list changed', () => {
    const changed = join(workDir, 'changed.ts');
    writeFileSync(changed, copy.replace('  quantity: number;\n  \n', '  quantity: number;\n  extra?: string;\n  \n'));
    const result = runCheck(changed);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('IMPORTANT types affected: FullBQItem');
  });

  it('exits 2 with an explanation when the path does not exist', () => {
    const result = runCheck(join(workDir, 'missing.ts'));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Not found');
  });
});
