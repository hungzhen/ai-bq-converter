# AI BQ Converter — Phase 2 Plan (Foundation & Core Processing)

Status: **PROPOSED — awaiting confirmation.** No application code has been written.
Specification: `docs/PHASE1_ARCHITECTURE.md` (Revision 2, approved).

Phase 2 builds the foundation and the first working part of the processing chain:
**synthetic spreadsheet in → extracted table with exact references → proposed column mapping and row classes, shown on screen.**

Phase 2 does **not** include:
- building `FullBQItem` rows (Phase 3)
- export (Phase 4)
- combining files or claims (Phase 5)
- PDF extraction or OCR (Phases 6–7)
- Supabase (Phase 8)
- Claude (Phase 9)

The interfaces for all of these are defined in Phase 2, so later phases plug in without rework.

---

## 1. Folder structure

✅ = created in Phase 2. ◻ = later phase (folder not created until needed).

```
ai-bq-converter/                      ✅ separate project — never inside the Cost Library folder
├── docs/                             ✅ PHASE1_ARCHITECTURE.md, PHASE2_PLAN.md, DECISIONS.md
├── index.html                        ✅
├── package.json / package-lock.json  ✅
├── tsconfig.json                     ✅
├── vite.config.ts                    ✅ (also holds the Vitest test settings)
├── .gitignore                        ✅ includes tests/fixtures/private/
├── README.md                         ✅ how to install, run, test
├── scripts/
│   └── check-cost-library-types.mjs  ✅ compares the vendored copy with a Cost Library checkout
├── src/
│   ├── main.tsx, App.tsx, index.css  ✅
│   ├── vendor/cost-library/          ✅ (as built in Stage 2B)
│   │   ├── types/costLibrary.ts      ✅ verbatim read-only copy (commit 00491965)
│   │   ├── utils/*.d.ts              ✅ 4 clearly marked stand-ins for types costLibrary.ts refers to
│   │   ├── index.ts                  ✅ types-only entry point used by the converter
│   │   ├── SOURCE.json               ✅ origin (repository, path, commit) and SHA-256 fingerprint
│   │   └── README.md                 ✅ rules, and how to check for / refresh changes
│   ├── core/                         ✅ pure TypeScript, no React
│   │   ├── models/                   ✅ all converter data structures (Stage 2C; see docs/DATA_MODELS.md)
│   │   ├── parsing/                  ✅ numbers, special values, units
│   │   ├── evidence/                 ✅ evidence verifier
│   │   ├── extraction/
│   │   │   ├── format-detect.ts      ✅ real file type from file bytes (incl. PDF recognised)
│   │   │   ├── spreadsheet/          ✅ XLSX / XLS / CSV → ExtractedTable
│   │   │   ├── pdf-digital/          ◻ Phase 6 (interface defined in Phase 2)
│   │   │   └── pdf-scanned/          ◻ Phase 7 (OCR; interface defined in Phase 2)
│   │   ├── pipeline/                 ✅ orchestrator skeleton
│   │   ├── structuring/              ◻ Phase 3
│   │   ├── templates/                ◻ Phase 3
│   │   ├── validation/, reconciliation/, export/   ◻ Phase 4
│   │   ├── merge/, claims/           ◻ Phase 5
│   ├── providers/
│   │   ├── types.ts                  ✅ InterpretationProvider interface
│   │   ├── registry.ts               ✅
│   │   ├── rule-based/               ✅ first rules: document type, header row, columns, rows
│   │   └── claude/README.md          ✅ design notes only — no code, no key
│   ├── rules/                        ✅ editable JSON rule files + checking schemas
│   ├── storage/                      ✅ StorageAdapter interface + in-memory adapter
│   ├── features/                     ✅ one screen: upload → extracted table → proposed mapping
│   └── components/ui/                ✅ basic table, badge (e.g. "Conventional rule-based processing")
└── tests/
    ├── unit/                         ✅ mirrors src/core and src/providers
    ├── integration/                  ✅ file → extraction → provider proposals
    ├── helpers/synthetic/            ✅ code that builds SYNTHETIC workbooks/CSV in memory
    ├── fixtures/private/             ✅ empty, git-ignored (your real documents, later)
    ├── golden/                       ◻ Phase 3
    └── compatibility/                ◻ Phase 4 (Cost Library import read-back test)
```

---

## 2. Technology stack

The core versions match your Cost Library (React 19, Vite 8, TypeScript 7, Tailwind 4), so the copied `costLibrary.ts` compiles identically. Exact versions are pinned when installed.

| Purpose | Choice | Phase | Note |
|---|---|---|---|
| Runtime / package manager | Node 22, npm | 2 | npm is simplest to run on your own PC |
| UI | React 19 + Vite 8 | 2 | Same as Cost Library |
| Language | TypeScript 7 (strict mode) | 2 | Same as Cost Library |
| Styling | Tailwind CSS 4 (`@tailwindcss/vite`) | 2 | Same as Cost Library |
| Tests | Vitest 5 (+ jsdom for screen tests) | 2 | Fast, shares Vite's settings |
| Spreadsheet reading (XLSX, **XLS**, CSV) | **SheetJS** | 2 | Only mainstream library that reads old `.xls`. See §5, decision A |
| CSV edge cases | PapaParse | 2 | Delimiter and text-encoding detection |
| Data checking | zod | 2 | Checks rule files now and future AI responses later |
| Local storage | In-memory now; IndexedDB (`idb`) | 2 / 3 | Nothing leaves your PC |
| Excel export | ExcelJS | 4 | Styled upload and reconciliation workbooks |
| Digital PDF | pdfjs-dist (Mozilla PDF.js) | 6 | Text with positions |
| Scanned PDF OCR | tesseract.js | 7 | Runs in the browser |
| Supabase client | @supabase/supabase-js | 8 | Development project only |
| Type check ("lint") | `tsc --noEmit` | 2 | Same approach as Cost Library |

**Commands you will use:**

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run lint
```

---

## 3. Phase 2 implementation sequence

Each stage is small, ends with passing tests, and is shown to you before the next one starts.

| Stage | What is built | Tests that prove it works |
|---|---|---|
| **2A Foundation** | Project setup, an empty app screen, test runner, README, `.gitignore` | App builds; a first test runs |
| **2B Cost Library types** | Verbatim copy of `costLibrary.ts`, 4 stand-in type files, `VENDOR.md`, comparison script | `FullBQItem` compiles; required fields are exactly `id, projectName, projectYear, description, unit, quantity, rate, amount, dateCreated, dateUpdated`; copy matches commit 00491965 |
| **2C Core models** | Source references, extracted tables, field evidence, `StagedBQRow` (wraps `FullBQItem`), row classes, claim models (separate files), templates, merge plan, issues, overrides, approval status | Reference formatting matches the Cost Library's `"Sheet: X \| Row N"`; PDF format `"Page N \| Line M"`; claim models have **no** `FullBQItem` dependency (automated check) |
| **2D Value parsing** | Turns cell text into numbers without losing the original: `"1,250.00"`, `"RM 1,250.00"`, `"(50.00)"`, `"-"`, `"Incl."`, `"Rate Only"`, `"R.O."`, `"P.C. Sum"`, `"Prov Sum"`, `"N/A"`, percentages; unit text kept verbatim with the expected Cost Library unit noted | Raw text always kept; negatives stay negative (and are flagged); blanks stay "not stated"; unreadable text flagged, never guessed |
| **2E Provider interface & evidence verifier** | `InterpretationProvider`, `Interpretation<T>` with cell evidence, provider registry, verifier that rejects uncited or mismatched answers | Shared "provider contract" test suite; verifier rejects: no evidence, missing cells, wrong quoted text, invalid values |
| **2F Spreadsheet extraction** | File type detection from bytes (XLSX, XLS, CSV, PDF recognised); XLSX/XLS/CSV → `ExtractedTable` keeping sheet name, row number, cell address, merged cells, hidden rows/columns, formulas and stored results | Built on synthetic workbooks generated in the test code: every cell's reference is correct; hidden rows flagged; formula without stored result flagged (not calculated); CSV with different delimiters |
| **2G RuleBasedProvider (first rules)** | Rule JSON files; document type (BQ / working file / claim / unknown), header row and data range, column meanings (using the Cost Library's `ColumnMappingConfig` field names), row classes (heading, item, note, subtotal, total, carried forward…) | Synthetic BQ, working-file and claim layouts classified correctly; every answer carries evidence and passes the verifier; labelled "Conventional rule-based processing" |
| **2H Pipeline & first screen** | Orchestrator skeleton, in-memory storage adapter, one screen: choose a file → see the extracted table with row/cell references → see the proposed column mapping and row classes with their reasons | End-to-end test: synthetic file → proposals; screen test: proposals and labels shown |

**At the end of Phase 2** you can open the app, load a spreadsheet and see what the converter *proposes*, with exactly which cells each proposal is based on.

Editing and approving proposals, building `FullBQItem` rows and reusable contractor templates follow in Phase 3.

---

## 4. First set of files (Stages 2A + 2B only)

**Stage 2A — Foundation**

| File | Purpose |
|---|---|
| `package.json` | Project name, scripts (`dev`, `build`, `test`, `lint`), dependencies |
| `package-lock.json` | Generated by npm; locks exact versions |
| `tsconfig.json` | TypeScript settings (strict) |
| `vite.config.ts` | Vite + React + Tailwind + Vitest settings |
| `index.html` | Page the app loads into |
| `src/main.tsx` | Starts React |
| `src/App.tsx` | Placeholder screen: project name, phase, and "Conventional rule-based processing — no AI in use" |
| `src/index.css` | Tailwind import |
| `.gitignore` | Ignores `node_modules`, build output, `tests/fixtures/private/`, `.env*` |
| `README.md` | Plain-English install / run / test instructions |
| `docs/DECISIONS.md` | Record of your decisions (§5) |
| `tests/unit/smoke.test.ts` | Proves the test runner works |
| `tests/fixtures/private/.gitkeep` | Keeps the private folder present but empty |

**Stage 2B — Cost Library types**

| File | Purpose |
|---|---|
| `src/vendor/cost-library/costLibrary.ts` | Exact copy of your file — never edited |
| `src/vendor/cost-library/VENDOR.md` | Source repository, commit, date, rules for refreshing |
| `src/vendor/utils/benchmark.ts` | Stand-in: `BenchmarkSettings = unknown` |
| `src/vendor/utils/estimateBasis.ts` | Stand-in: `BillKind = string` |
| `src/vendor/utils/billArea.ts` | Stand-ins: `BillAreaSource`, `AreaUnit` |
| `src/vendor/utils/projectDetails.ts` | Stand-in: `ProjectDetails = unknown` |
| `scripts/check-cost-library-types.mjs` | Reports any difference from a Cost Library checkout |
| `tests/unit/vendor/fullBQItem.test.ts` | Confirms the target schema is as reviewed |

The stand-ins sit at the relative paths `costLibrary.ts` already refers to (`../utils/…`), so the copy stays word-for-word identical. The converter never fills in those settings fields.

Note: the copied file also contains Cost Library helper functions. The converter will **not** use `parseCleanRate`, because it removes minus signs. It uses `normalizeUnit` only to *predict* what the Cost Library will store, never to change the source unit.

---

## 5. Decisions needed before Stage 2A

**A. SheetJS source.** The npm copy (0.18.5, which your Cost Library uses) has published security advisories. That matters here because the converter opens files from outside parties. The current version (0.20.x) is published only on `cdn.sheetjs.com`, which this cloud environment's network currently blocks.

- **Recommended:** allow `cdn.sheetjs.com` for this environment. I would request this through the environment settings, and you approve it in a prompt. Then use the current version.
- **Alternative:** use npm 0.18.5 now, record the advisories in `DECISIONS.md`, and upgrade before real documents are processed.

**B. Repository.** This cloud workspace is temporary. Please create an **empty** GitHub repository (e.g. `hungzhen/ai-bq-converter`) so each stage can be committed and kept. Until then, work exists only in this session.

**C. Revision 2, §19 open decisions.** Unless you say otherwise, I will use the recommended options:
1. Negative values block export until handled.
2. Store a read-only copy of `costLibrary.ts` (needed for Stage 2B).
3. One upload workbook per pricing option, after testing.
4. Notes go to the reconciliation workbook only.
5. Classification fields are left blank for the Cost Library.
