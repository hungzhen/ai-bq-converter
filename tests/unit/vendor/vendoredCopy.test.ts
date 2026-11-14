/**
 * Stage 2B — the read-only copy of the Cost Library's costLibrary.ts.
 *
 * Proves that:
 *  - the copy is byte-for-byte what was copied from commit 00491965 (any edit fails this test);
 *  - its origin (repository, file path, commit) is recorded;
 *  - the stand-in files are clearly marked, contain no code, and cover every outside reference;
 *  - the converter's entry point exports types only (no Cost Library functions such as parseCleanRate).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sha256 } from '../../../scripts/cost-library-sync/compareSource.ts';
import * as costLibraryEntry from '../../../src/vendor/cost-library/index.ts';

const root = resolve(import.meta.dirname, '../../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

interface SourceManifest {
  repository: string;
  sourcePath: string;
  commit: string;
  vendoredPath: string;
  sha256: string;
  lines: number;
  standIns: { path: string; provides: string[]; kind: string }[];
}

const manifest = JSON.parse(read('src/vendor/cost-library/SOURCE.json')) as SourceManifest;
const copy = read(manifest.vendoredPath);

/** Fingerprint of costLibrary.ts at commit 00491965, fixed here as a second lock next to SOURCE.json. */
const REVIEWED_SHA256 = '936d100e1d10f94b7b543ec841a48524c57eb6b2c83c4d5d62e5236d0d9aea63';

describe('origin of the copy is recorded', () => {
  it('names the original repository, file path and full commit hash', () => {
    expect(manifest.repository).toBe('hungzhen/Cost-Library');
    expect(manifest.sourcePath).toBe('src/types/costLibrary.ts');
    expect(manifest.commit).toBe('00491965a20cc9b68d7a928ddbcac3b68e91ccfc');
    expect(manifest.vendoredPath).toBe('src/vendor/cost-library/types/costLibrary.ts');
  });
});

describe('the copy is exact and unedited', () => {
  it('matches the SHA-256 fingerprint recorded in SOURCE.json', () => {
    expect(sha256(copy)).toBe(manifest.sha256);
  });

  it('matches the fingerprint of the reviewed commit 00491965', () => {
    expect(manifest.sha256).toBe(REVIEWED_SHA256);
  });

  it('has the original number of lines', () => {
    expect(copy.split('\n').length - 1).toBe(manifest.lines);
    expect(manifest.lines).toBe(1968);
  });

  it('contains no stand-in marker (it is the original, not a converter file)', () => {
    expect(copy).not.toContain('STAND-IN');
  });
});

describe('stand-in files are clearly separate from the original', () => {
  it('lists four stand-ins in SOURCE.json', () => {
    expect(manifest.standIns.map((s) => s.path).sort()).toEqual([
      'src/vendor/cost-library/utils/benchmark.d.ts',
      'src/vendor/cost-library/utils/billArea.d.ts',
      'src/vendor/cost-library/utils/estimateBasis.d.ts',
      'src/vendor/cost-library/utils/projectDetails.d.ts',
    ]);
  });

  for (const standIn of manifest.standIns) {
    describe(standIn.path, () => {
      const text = existsSync(join(root, standIn.path)) ? read(standIn.path) : '';

      it('exists and is a declaration-only (.d.ts) file', () => {
        expect(text).not.toBe('');
        expect(standIn.path.endsWith('.d.ts')).toBe(true);
      });

      it('starts with the "STAND-IN — NOT AN ORIGINAL COST LIBRARY FILE" banner', () => {
        expect(text.slice(0, 300)).toContain('STAND-IN — NOT AN ORIGINAL COST LIBRARY FILE');
      });

      it('contains no code, only type definitions', () => {
        expect(text).not.toMatch(/^export\s+(const|let|var|function|class|enum)\b/m);
      });

      it(`defines ${standIn.provides.join(', ')}`, () => {
        for (const name of standIn.provides) {
          expect(text).toMatch(new RegExp(`^export type ${name}\\b`, 'm'));
        }
      });
    });
  }

  it('covers every reference the copy makes to other Cost Library files', () => {
    const references = [...copy.matchAll(/import\('\.\.\/utils\/([\w-]+)'\)\.(\w+)/g)].map((m) => ({
      file: `src/vendor/cost-library/utils/${m[1]}.d.ts`,
      name: m[2]!,
    }));
    expect(references.length).toBe(6);
    for (const ref of references) {
      const standIn = manifest.standIns.find((s) => s.path === ref.file);
      expect(standIn, `stand-in for ${ref.file}`).toBeDefined();
      expect(standIn?.provides).toContain(ref.name);
    }
  });
});

describe('converter entry point (src/vendor/cost-library/index.ts)', () => {
  it('exports types only — no Cost Library functions such as parseCleanRate', () => {
    expect(Object.keys(costLibraryEntry)).toEqual([]);
  });
});
