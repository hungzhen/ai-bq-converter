/**
 * Detects whether the Cost Library's costLibrary.ts has changed since the converter's copy was made.
 *
 * READ-ONLY: it reads files (or `git show` output) and prints a report. It never changes the
 * Cost Library checkout or the converter's copy. The copy is never updated automatically.
 *
 * Usage:
 *   npm run check:cost-library -- <path>                 path = Cost Library folder, or the file itself
 *   npm run check:cost-library -- <folder> --ref <ref>   compare a commit / branch, e.g. origin/main
 *
 * Exit code: 0 = unchanged, 1 = changed, 2 = could not compare (or the converter's copy was edited).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compareSources, formatReport, sha256 } from './cost-library-sync/compareSource.ts';

interface SourceManifest {
  repository: string;
  sourcePath: string;
  commit: string;
  vendoredPath: string;
  sha256: string;
}

const projectRoot = resolve(import.meta.dirname, '..');

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(2);
}

function readOther(target: string, ref: string | undefined, sourcePath: string): { text: string; label: string } {
  if (!existsSync(target)) fail(`Not found: ${target}`);
  const isFolder = statSync(target).isDirectory();

  if (ref) {
    if (!isFolder) fail('--ref needs a Cost Library folder (a git checkout), not a file.');
    try {
      const text = execFileSync('git', ['-C', target, 'show', `${ref}:${sourcePath}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      return { text, label: `${target} @ ${ref} : ${sourcePath}` };
    } catch {
      fail(`Could not read ${sourcePath} at "${ref}" in ${target}.`);
    }
  }

  const file = isFolder ? join(target, sourcePath) : target;
  if (!existsSync(file)) fail(`Not found: ${file}`);
  return { text: readFileSync(file, 'utf8'), label: file };
}

function main(): void {
  const args = process.argv.slice(2);
  const refIndex = args.indexOf('--ref');
  const ref = refIndex >= 0 ? args[refIndex + 1] : undefined;
  if (refIndex >= 0 && !ref) fail('--ref needs a value, e.g. --ref origin/main');
  // The path is the first argument that is neither an option nor the value given after --ref.
  const target = args.find((a, i) => !a.startsWith('--') && !(refIndex >= 0 && i === refIndex + 1));
  if (!target) fail('Give the path of a Cost Library folder or of its src/types/costLibrary.ts file.');

  const manifest = JSON.parse(
    readFileSync(join(projectRoot, 'src/vendor/cost-library/SOURCE.json'), 'utf8'),
  ) as SourceManifest;
  const vendoredText = readFileSync(join(projectRoot, manifest.vendoredPath), 'utf8');

  // Safety check first: the copy itself must still be exactly what was recorded.
  if (sha256(vendoredText) !== manifest.sha256) {
    fail(
      `The converter's copy (${manifest.vendoredPath}) no longer matches SOURCE.json. ` +
        'It may have been edited by hand. Restore it before comparing.',
    );
  }

  const other = readOther(resolve(target), ref, manifest.sourcePath);
  const report = compareSources(vendoredText, other.text);

  console.log(
    formatReport(report, {
      vendored: `${manifest.vendoredPath} (copied from ${manifest.repository} @ ${manifest.commit.slice(0, 8)})`,
      other: other.label,
    }),
  );
  process.exit(report.identical ? 0 : 1);
}

main();
