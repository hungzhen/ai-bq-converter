# Cost Library types: read-only copy

This folder holds an **exact copy** of the Cost Library's type definitions. The converter uses `FullBQItem` from it as the target format for standard BQ output.

| | |
|---|---|
| Original repository | `hungzhen/Cost-Library` |
| Original file | `src/types/costLibrary.ts` |
| Commit | `00491965a20cc9b68d7a928ddbcac3b68e91ccfc` (2026-11-13) |
| SHA-256 of the copy | `936d100e1d10f94b7b543ec841a48524c57eb6b2c83c4d5d62e5236d0d9aea63` |

The same details are in machine-readable form in `SOURCE.json`.

## What is in this folder

| File | Original or not? | Purpose |
|---|---|---|
| `types/costLibrary.ts` | **ORIGINAL — exact copy, never edit** | The Cost Library's types, byte-for-byte |
| `utils/estimateBasis.d.ts` | Stand-in (exact transcription) | `BillKind`, referenced by the copy |
| `utils/billArea.d.ts` | Stand-in (exact transcription) | `AreaUnit`, `BillAreaSource`, referenced by the copy |
| `utils/benchmark.d.ts` | Stand-in (placeholder `unknown`) | `BenchmarkSettings`, never used by the converter |
| `utils/projectDetails.d.ts` | Stand-in (placeholder `unknown`) | `ProjectDetails`, never used by the converter |
| `index.ts` | Converter file | The entry point for types: re-exports **types only** |
| `taxonomy.ts` | Converter file | Re-exports only the two reference lists `UNIFIED_TRADE_PACKAGES` and `TRADE_SUBTRADES`, used to suggest and check Trade / Sub-trade labels. No functions |
| `SOURCE.json` | Converter file | Where the copy came from, and its fingerprint |

The stand-ins are `.d.ts` (type declaration) files, so they contain no code. Each starts with the banner `STAND-IN — NOT AN ORIGINAL COST LIBRARY FILE`. They sit at `utils/…` because that is where the copied file looks for them (`import('../utils/…')`), which lets the copy stay unchanged.

## Rules

1. **Never edit `types/costLibrary.ts`.** A test compares its fingerprint with `SOURCE.json`, so any edit, even one character, makes `npm test` fail.
2. **Import only from `index.ts`** (types) **or `taxonomy.ts`** (the two trade lists). Cost Library functions, especially `parseCleanRate`, which removes minus signs, are not used by the converter.
3. **Refresh only when the owner asks.** Nothing updates the copy automatically.

## Checking whether the Cost Library has changed

This **reads** a Cost Library checkout and reports differences. It never changes either side.

```bash
npm run check:cost-library -- /path/to/Cost-Library
```

You can also pass the file itself, or compare a specific commit or branch of a checkout:

```bash
npm run check:cost-library -- /path/to/Cost-Library --ref origin/main
```

The report says:
- **UNCHANGED:** identical to the copy.
- **CHANGED:** lists which definitions were added, removed or changed. If `FullBQItem` or the other important types are among them, it says so first.

Exit code: 0 = unchanged, 1 = changed, 2 = could not compare.

## How to refresh (only on the owner's instruction)

1. Copy the file byte-for-byte from the chosen commit:

   ```bash
   git -C /path/to/Cost-Library show <commit>:src/types/costLibrary.ts > src/vendor/cost-library/types/costLibrary.ts
   ```

2. Update `SOURCE.json` (commit, date, message, `sha256`, line count) and the table above.
3. Check whether new `import('../utils/…')` references need stand-ins.
4. Run the checks:

   ```bash
   npm run lint
   ```

   ```bash
   npm test
   ```

   ```bash
   npm run build
   ```

5. Review the converter code affected by any changed types.
