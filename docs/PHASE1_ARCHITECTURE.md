# AI BQ Converter — Phase 1 Architecture Proposal (Revision 2)

Status: **REVISED DRAFT — awaiting approval.** No application code has been written.

Revision 2 adds:
- **Your seven adjustments:**
  - a broader ClaudeProvider role
  - reusable contractor layout templates
  - reconciliation from each output item back to its source
  - combining several files into one project
  - separate claim data
  - RuleBasedProvider first
- **Review of the Cost Library:** `src/types/costLibrary.ts` and the two Excel import routines that read uploads.

Cost Library reviewed: `hungzhen/Cost-Library`, commit `00491965` (read-only clone; nothing changed, committed or pushed).

---

## 0. Guiding principles

1. **The target schema is your existing `FullBQItem`.** The converter does not define its own BQ item schema. Every standard BQ row it produces is a `FullBQItem`. The extra structures below only hold evidence, status and claim data around it.
2. **The document is the source of truth.** Every quantity, rate, amount, unit, item number and description must come from a specific cell, PDF position or OCR word. If something isn't in the document, it stays empty and is flagged. Nothing is guessed or filled in, whether by rules or, later, by Claude.
3. **The raw value is kept next to the interpreted one.** `"1,250.00"` (raw text) is stored with `1250` (the parsed number).
4. **Every output row can be traced back to its source.** Each output row records its file, worksheet and row, or PDF page and position. Every source row is accounted for: used, or excluded with a stated reason.
5. **BQ data and claim data stay apart.** Claims have their own data model. They point at BQ rows but never write to them.
6. **Interpretation is pluggable.** RuleBasedProvider is used now; ClaudeProvider comes later. Both use the same interface. Rule-based results are labelled *"Conventional rule-based processing"*.
7. **The user approves.** Automatic decisions are proposals. Approved corrections are recorded, can be reused, and never overwrite the original values.
8. **The Cost Library is not modified.** Data moves into it only through its existing Excel import, done by a person.

---

## 1. What I found in the Cost Library (and why it matters)

### 1.1 `FullBQItem` — the target

**Required fields:** `id`, `projectName`, `projectYear` (format `"2024 Q1"`), `description`, `unit`, `quantity`, `rate`, `amount`, `dateCreated`, `dateUpdated`. Everything else is optional.

The hierarchy is **Project → Bill → Level 2 Element / Section → Headings (3 levels) → Item**:

- **Bill:** `billNo`, `billDescription`
- **Section:** `sectionNo`, `sectionDescription`
- **Level 2 Element:** `element`, `elementCode`, `elementId`
- **Headings:** `mainHeading`, `subheading`, `secondarySubheading`, `parentSpecDescription`
- **Item:** `itemNo`, `originalItemNo`

**Financial fields that already exist:**

- **Original values, never overwritten:** `originalRate` and `originalAmount`.
- **Base, tender and profit fields:** `baseRate`, `baseAmount`, `tenderRate`, `tenderAmount`, `profitPercent` and `rateAfterDiscount`.
- **Final values:** `rate` and `amount` hold the final rate and amount.
- **Special pricing:** `rateOnly` marks a rate-only item, `quantityBreakdowns` (`ItemQuantityColumn[]`) holds multiple quantity columns, `optionPrices` (`OptionPrice` by option id) holds pricing options, and `percentageOf` holds percentage items such as profit or attendance on a PC sum.
- **Row type and scope:** `rowType` (`BQRowType`), `costScopeType` (`BQCostScopeType`), `isHeaderRow`, `isSubtotalOrTotal` and `isNonPricedReference`.
- **Provenance:** `sourceFile`, `sourceReference` (format `"Sheet: X | Row N"`), `sourceRowNumber` and `sourceSequence`.

### 1.2 How the Cost Library imports Excel today

There are two import routes:

- **Route A (main):** the user uploads a BQ as it is, and the import workflow (`bqImportAnalyzer.ts`) finds each sheet's columns.
- **Route B:** the user fills in the **"BQ" template sheet**. Its columns are `No. | Bill | Level 2 Element | Main Heading | Subheading | Secondary Subheading | Item Description | Unit | Qty | Rate (RM) | Amount (RM)`, with optional Base Rate, Tender Rate, Profit % and extra Qty/Amount pairs. The template's rules say: *items only, no page totals, collection rows or summaries.*

**Things the importer does on its own.** These are important for the "never invent" rule. I will not change them, but the converter must plan around them:

| Importer behaviour | Effect | How the converter handles it |
|---|---|---|
| Blank amount + qty + rate → computes `amount = qty × rate`; blank rate → computes `rate = amount ÷ qty` | A value appears that wasn't in the source | Converter exports **exact source values**. The reconciliation report lists every row where the Cost Library will compute a value, so you can see it before uploading |
| `parseCleanRate` uses `Math.abs` | **Negative values (omissions, credits, deductions) become positive** | Converter flags every negative value as **"needs manual handling"**. Blocking or adjusting them is your decision (§16) |
| Missing project year → `"2024 Q1"` | A year is invented | Converter **requires** you to enter the project year; never defaulted |
| Trade defaults (e.g. `05-concrete-works`, or SMM2 bill trades); `costItem` = first 45 characters of the description; `materialCategory` / `structuralElement` guessed from text | Classification metadata invented | These are Cost Library classification features, not source values. Converter leaves them blank unless you approve a value. Reconciliation shows they will be inferred |
| Units normalised (`m2` → `m²`, `nos` → `nr`) | Unit text changes | Converter exports the original unit text and records the expected normalised unit |
| Sets `sourceFile` / `sourceReference` to **the uploaded file's own** sheet and row | The original document's references would be replaced by the converter's export file references | Solved with a **trace link** (§9.3): every export row has a stable row number, and the reconciliation workbook maps it back to the original file, sheet and row or page and position |
| `notes` is set to `''` on Route A | Notes column ignored | Source notes are kept in the converter and the reconciliation workbook |

### 1.3 Other types used as the shared vocabulary

- **`ColumnMappingConfig` / `QuantityColumnMapping`:** the converter's column mappings use the **same field names** (`itemNoCol`, `descCol`, `unitCol`, `qtyCol`, `rateCol`, `amtCol`, `baseRateCol`, `tenderRateCol`, `profitCol`, `rateAfterDiscountCol`, `elementCol`, `additionalQtyCols`…). This avoids a second vocabulary.
- **`BQImportRowClassification`:** the converter's row classes are this set plus a few extra converter-only classes (§7).
- **`BillQuantityLayout` / `BillQuantityPair` / `ItemQuantityColumn`:** used for multiple quantity columns (§8.1).
- **`OptionPrice` / `PricingOptionsSetting`:** used for pricing options (§8.2).
- **`ProjectSettings`:** the converter **does not create** project settings rows. The Cost Library manages them after import.

### 1.4 How the converter will use these types without changing the Cost Library

I recommend storing a **read-only copy** of `costLibrary.ts` in the converter, at `src/vendor/cost-library/costLibrary.ts`:
- A header comment will record the source commit, and the copy is never edited by hand.
- That file refers to five types in other Cost Library files (`BenchmarkSettings`, `BillKind`, `BillAreaSource`, `AreaUnit`, `ProjectDetails`). The converter never fills those in, so they are stubbed as `unknown` in a small shim file.
- A check script compares the copy with a Cost Library checkout and reports any difference, so changes to `FullBQItem` are noticed.

---

## 2. Architecture

```
┌────────────────────────────── Browser (React + Vite + Tailwind) ──────────────────────────────┐
│ UI: Project → Upload files → Classify → Map (templates) → Review rows → Merge → Reconcile → Export
│                                                                                                │
│ Pipeline orchestrator (core/pipeline) — records every decision in an audit trail               │
│   ├─ Extraction           XLSX/XLS/CSV · digital PDF · scanned PDF (OCR) → ExtractedTable      │
│   ├─ Template matching    finds approved contractor layouts for this file                      │
│   ├─ Interpretation  ◄── InterpretationProvider interface                                      │
│   │      ├─ RuleBasedProvider  (now)   conventional rules, patterns, statistics                │
│   │      └─ ClaudeProvider     (later) via a server function; key never in the browser         │
│   ├─ Evidence verifier    rejects any interpretation that cites missing or mismatched cells    │
│   ├─ Value parsing        code copies values from cells; providers never supply values         │
│   ├─ Structuring          bills, elements, headings, continuations → StagedBQRow (FullBQItem)  │
│   ├─ Claim structuring    → ClaimLine (separate model)                                         │
│   ├─ Project merge        several files → one standard BQ                                      │
│   ├─ Validation & reconciliation                                                               │
│   └─ Export               Cost Library upload workbook + reconciliation workbook + claims      │
│                                                                                                │
│ Storage adapter: Local (IndexedDB) now → Supabase dev project later                           │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

The heavy steps (spreadsheet reading, PDF reading, OCR) run in Web Workers. The conversion logic in `src/core` has no React in it, so it can be tested on its own and could later move to a server.

---

## 3. Folder structure

```
ai-bq-converter/
├── docs/                              Architecture, decisions, rule documentation
├── src/
│   ├── app/                           Shell, routing, layout
│   ├── features/                      Screens
│   │   ├── projects/                  Project setup (name, year — required, never defaulted)
│   │   ├── upload/
│   │   ├── classification-review/
│   │   ├── column-mapping/            Includes "save as contractor template"
│   │   ├── row-review/                Source snippet ↔ converted row, side by side
│   │   ├── project-merge/             Combine files, resolve overlaps
│   │   ├── reconciliation/
│   │   ├── claims/                    Separate claim review screens
│   │   └── export/
│   ├── components/ui/
│   │
│   ├── vendor/cost-library/           ★ Read-only copy of costLibrary.ts + shim (see §1.4)
│   │
│   ├── core/                          ★ Pure TypeScript, no React
│   │   ├── models/                    Converter models (§14)
│   │   ├── extraction/                spreadsheet/, pdf-digital/, pdf-scanned/, table-reconstruction/
│   │   ├── templates/                 Contractor layout templates: fingerprinting, matching, applying
│   │   ├── parsing/                   Numbers, units, special values ("Incl.", "Rate Only", PS, PC)
│   │   ├── structuring/               Hierarchy, continuations, quantity columns, pricing options
│   │   ├── claims/                    Claim structuring and BQ matching
│   │   ├── merge/                     Multi-file project merge
│   │   ├── evidence/                  Evidence verifier (checks every provider citation)
│   │   ├── validation/                Arithmetic and completeness checks
│   │   ├── reconciliation/            Line trace, totals check, coverage check
│   │   ├── export/
│   │   │   ├── cost-library-workbook/ Upload-ready workbook in the Cost Library's import format
│   │   │   ├── reconciliation-workbook/
│   │   │   └── claims-workbook/
│   │   └── pipeline/
│   │
│   ├── providers/
│   │   ├── types.ts                   InterpretationProvider interface (§13)
│   │   ├── registry.ts
│   │   ├── rule-based/                RuleBasedProvider
│   │   └── claude/README.md           Design notes only — no code, no key
│   │
│   ├── rules/                         Editable JSON rules + zod schemas
│   ├── storage/                       StorageAdapter + LocalAdapter (IndexedDB)
│   ├── workers/
│   └── lib/
│
├── scripts/check-cost-library-types.mjs   Compares the vendored copy with a Cost Library checkout
├── tests/
│   ├── unit/  integration/  golden/
│   ├── compatibility/                 Runs the Cost Library's own import code against our export (§15)
│   ├── fixtures/synthetic/            Generated, labelled "SYNTHETIC — NOT REAL COST DATA"
│   └── fixtures/private/              Your anonymised documents — git-ignored, never committed
└── supabase/migrations/               DRAFT SQL for the converter's own schema — not applied anywhere
```

---

## 4. Database integration plan

- **Phases 2–6: no database.** Everything stays in the browser.
- **Later, only with your approval:** a local Supabase or a separate development project. Never the Cost Library production project (`oobfgxabywmafymtmiqv`).
- **Converter tables go in their own schema,** `bq_converter`. Nothing is ever written to `public.cost_library_items`.
- **Every row has `organization_id` and `created_by`.** Row Level Security limits each organisation to its own data, which makes the app ready for multiple users.
- **A direct write to the Cost Library is not planned.** If you ever want one, it would have to go through the Cost Library's own `bq-write` Edge Function, as its rules require, as a separately approved change to that repository.

Draft tables:

| Table | Purpose |
|---|---|
| `organizations`, `organization_members` | Multi-user access |
| `projects` | Converter project (name, project year, and project type/location if stated) |
| `source_documents` | Uploaded files: hash, format, storage path, document type |
| `document_relationships` | e.g. claim → BQ, working file → BQ, addendum → BQ, file A supersedes file B |
| `extracted_tables` | Raw extracted grids, kept for audit |
| `contractors` | Contractor names and aliases |
| `layout_templates` | Approved contractor layouts, versioned (§10) |
| `conversion_runs` | Provider used, rule-set version, template used, status |
| `staged_bq_rows` | Draft `FullBQItem` + evidence per field (§14) |
| `merge_plans` | How several files combine into one BQ (§11) |
| `claim_documents`, `claim_lines`, `claim_adjustments` | Claim data — separate (§12) |
| `user_overrides` | Every correction: before, after, who, when |
| `reconciliation_reports`, `validation_issues` | Results of checks |
| `export_batches` | Each export: files produced, row trace, approval |

---

## 5. Document processing flow

```
 1  PROJECT      Create or select a converter project. Enter the project name and project year
                 ("2024 Q1" format, required, never defaulted).
 2  UPLOAD       One or more files. SHA-256 hash; real format detected from the file bytes.
 3  EXTRACT      Common ExtractedTable format for every file type, keeping cell, page and
                 position references.
 4  CLASSIFY     Document type: standard BQ | contractor working file | progress claim |
                 summary only | unknown. User confirms.
 5  TEMPLATE     Check approved contractor templates; best match proposed with a score.
 6  LOCATE       Sheets/pages to use or skip (cover, summary, collection, working sheets),
                 header rows, data range.
 7  MAP COLUMNS  To ColumnMappingConfig fields + extra quantity columns + pricing options +
                 claim columns. User confirms; can save or update a contractor template.
 8  CLASSIFY ROWS Row classes (§7). User can correct any row.
 9  PARSE        Code copies values from cells. Special values recognised. Raw text kept.
10  STRUCTURE    BQ files → StagedBQRow (FullBQItem + evidence).
                 Claim files → ClaimDocument + ClaimLine (separate).
11  MERGE        All BQ files of the project → one standard BQ (§11).
12  VALIDATE &   Arithmetic, totals against stated totals, coverage, Cost Library import effects.
    RECONCILE
13  APPROVE      User approves the project BQ (export is blocked until blocking issues are resolved
                 or explicitly accepted).
14  EXPORT       (a) Cost Library upload workbook  (b) Reconciliation workbook
                 (c) Claims workbook, if any — never mixed into (a).
15  UPLOAD       A person uploads (a) through the Cost Library's existing import screen, then
                 checks the Cost Library's import summary totals against (b).
```

---

## 6. Converting standard BQs and contractor working files into `FullBQItem`

### 6.1 Two layers: draft `FullBQItem` + evidence

Each converted row is a **`StagedBQRow`**. It contains:
- `item: FullBQItem`: the real Cost Library type, unchanged.
- `evidence`: for each filled field, the source cells it came from, the raw text, and how it was decided.
- `missing`: required `FullBQItem` fields not stated in the source (see §6.3).

Every row is therefore a genuine `FullBQItem` from the start, and every value in it can be traced.

### 6.2 Field-by-field mapping

| `FullBQItem` field | Filled from | Rule |
|---|---|---|
| `id` | Generated | Stable converter id (the Cost Library assigns its own on import) |
| `projectName`, `projectYear` | Converter project | Entered by you; year required, never defaulted |
| `projectRef`, `projectType`, `location`, `gfaM2` | Document, only if stated | Otherwise left empty (the Cost Library's own rule: *entered in Edit Project Info, never assumed*) |
| `billNo`, `billDescription` | Bill heading, sheet name or "BILL NO. 3 – …" text | Verbatim text kept; formatted as `"Bill 3 - Building Works"` for the template's Bill column |
| `sectionNo`, `sectionDescription` | Section heading rows | Verbatim |
| `element`, `elementCode` | Level 2 sections of an elemental bill (e.g. "Frame", "Tower A") | Proposed, user confirms; exported in the "Level 2 Element" column |
| `mainHeading`, `subheading`, `secondarySubheading` | Heading rows above the item (3 levels) | Verbatim; level decided by provider + user |
| `parentSpecDescription` | Nearest descriptive row above the item (e.g. "Reinforced concrete grade … as described in") | Verbatim |
| `itemNo`, `originalItemNo` | Item column | Verbatim (`"A"`, `"1.1"`, `"B.2"`) |
| `description` | Description column, plus continuation rows | Verbatim; each continuation row kept separately in the evidence |
| `unit` | Unit column | Original text kept; expected Cost Library normalisation recorded |
| `quantity` | Qty column (or sum of quantity columns, §8.1) | Source value only |
| `rate`, `amount` | Rate/Amount columns | Source values only |
| `originalRate`, `originalAmount` | Same source values | The Cost Library sets these from the uploaded Rate/Amount; the converter checks they match |
| `baseRate`, `baseAmount`, `tenderRate`, `tenderAmount`, `profitPercent`, `rateAfterDiscount` | Only when the document has those columns (typical of contractor working files) | Never calculated by the converter |
| `rateOnly` | "Rate Only" / "R.O." in the Qty or Amount column | Exported as that text so the importer recognises it |
| `quantityBreakdowns` | Additional quantity columns | §8.1 |
| `optionPrices` | Side-by-side pricing options | §8.2 |
| `percentageOf` | "Allow for profit / attendance %" rows under PC / Provisional Sums | §8.3 |
| `costScopeType`, `rowType`, `isHeaderRow`, `isSubtotalOrTotal`, `isNonPricedReference` | Row classification | §7 |
| `tradeWork`, `subTrade`, `costItem`, `materialCategory`, `structuralElement`, `specification` | Not source values | Left blank unless the document has such a column, or you approve a suggestion. Suggestions are labelled as rule-based (or later AI) suggestions |
| `sourceFile`, `sourceReference`, `sourceRowNumber`, `sourceSequence` | Original document | Kept in the converter. Re-linked after upload through the trace (§9.3) |
| `notes` | Remarks column if present | Kept in the converter and the reconciliation workbook |
| `dateCreated`, `dateUpdated` | Generated | — |
| `actualCost` | **Never from a BQ or a claim** | Claims are not actual cost |
| `displayItemNo`, `sequentialNo`, `headingLevels`, `hierarchyManuallySet`, `hierarchyLevel`, `billHasElementalBreakdown`, `billElement`, `projectSettings`, `rowVersion` | Managed by the Cost Library | Not set by the converter |

### 6.3 Required numeric fields that are not stated in the source

`FullBQItem.quantity`, `rate` and `amount` are required numbers. A BQ often leaves them blank: headings, lump sums with only an amount, unpriced items, and "Incl." or "Rate Only" items. The converter handles this as follows:

1. It keeps them as **"not stated"** in the evidence, never as an invented number.
2. In the draft `FullBQItem`, it uses `0`, which matches the Cost Library's own convention for heading and blank rows, and marks the field in `missing`.
3. In the export workbook, it leaves the **cell blank**, not 0, so the file matches the source.
4. The reconciliation report lists what the Cost Library will store for each such cell (0, or a value it calculates).

The template note *"for a lump sum use 1"* is **not** applied automatically. It would invent a quantity. It is shown as a suggestion you can accept per row.

### 6.4 Contractor working files

A working file is usually a copy of the BQ with extra columns:
- cost build-ups (material, labour, plant, subcontractor)
- supplier or subcontractor quotations
- markup and profit
- several rate columns
- sometimes hidden rows

How these are handled:
- **Columns with a `FullBQItem` field:** cost rate goes to `baseRate`/`baseAmount`, selling rate to `rate`/`tenderRate`, profit to `profitPercent`, and the discounted rate to `rateAfterDiscount`.
- **Columns with no `FullBQItem` field** (e.g. material/labour split, supplier name): kept in the converter as **`ExtraColumnValue`s** with references. They appear in the reconciliation workbook but **are not uploaded**, because the Cost Library has nowhere to store them.
- **Hidden rows and columns:** marked as hidden. You decide whether to include them, and the default is to show and flag them.
- **Linking to the original BQ:** if the working file belongs to a BQ already in the project, a `DocumentRelationship` (`working_file_of`) links them. Rows are matched by bill + item number + description.

---

## 7. Identifying and mapping row types

The converter uses **your `BQImportRowClassification` values** plus a few converter-only classes. These cover rows that the Cost Library template says must not be uploaded, and rows the converter needs to report on.

| Converter row class | Typical source signals | Becomes | `FullBQItem` result |
|---|---|---|---|
| `bill_heading` *(extra)* | "BILL NO. 3", sheet name, bill title row | Bill context | `billNo` / `billDescription` on every row below; `rowType: 'bill_heading'` |
| `section_heading` *(extra)* | "SECTION 2", "ELEMENT 4 – FRAME", "BILL NO. 2.1 – …" | Section or Level 2 | `sectionNo`/`sectionDescription` or `element`; `rowType: 'section_heading'` |
| `main_heading` | Bold/underlined/capitals, no unit/qty/rate, trade title | Level 1 heading | `mainHeading` on items; `isHeaderRow: true` |
| `subheading` | Descriptive row, no figures, under a main heading | Level 2 heading | `subheading`; `rowType: 'subheading'` |
| `secondary_subheading` | Third heading level | Level 3 heading | `secondarySubheading`; `rowType: 'secondary_subheading'` |
| `priced_item` | Item no and/or unit + qty and/or rate/amount, or a special value | Item | `rowType: 'cost_item'`; `costScopeType` per §7.1 |
| `continuation` *(extra)* | Description text only, directly under an item, no item no / figures | Part of the item above | Joined into `description`; own source row kept in evidence |
| `note` | Preamble, "Generally", "Notes:", specification paragraphs | Note | `rowType: 'note'`; exported per §15.2 |
| `note_label` | Short label such as "Note:" | Note label | As `note` |
| `subtotal` | "Total carried to collection", "Page total", "Sub-total", "To collection" | Subtotal | **Not uploaded** (template rule 1); used in the totals check |
| `total` *(extra)* | "Total carried to summary", "Grand total", "Bill total" | Total | **Not uploaded**; used in the totals check |
| `brought_forward` / `carried_forward` *(extra)* | "Brought forward", "Carried forward" | Page link | **Not uploaded**; checked |
| `collection` / `summary` *(extra)* | Collection page or summary sheet rows | Stated totals | **Not uploaded**; source of stated totals for reconciliation |
| `reference` *(extra)* | Page numbers, "Page 3/12", drawing references | Reference | `isNonPricedReference: true`; not uploaded |
| `ignore` | Blank rows, repeated column headers, printing artefacts | — | Listed in coverage report with reason |

### 7.1 Cost scope (`BQCostScopeType`)

| Scope | Decided from |
|---|---|
| `preliminaries` | Bill/section titled Preliminaries |
| `provisional_sum` | "Provisional Sum", "P.S." |
| `prime_cost` | "Prime Cost Sum", "P.C. Sum" |
| `lump_sum` | Unit "Sum"/"LS"/"Item" with amount only |
| `contingency` | "Contingency" |
| `tax` | "SST", "Tax" |
| `subtotal` / `total` | Row classes above |
| `measured` | Default for priced items |
| `other` | Anything else |

Each decision has evidence (the matching text) and can be changed by the user. Note that the Cost Library's import also works out its own scope from keywords. The reconciliation report flags any row where the two disagree.

### 7.2 How the rule-based provider decides

The rules sit in editable JSON files:
- **Text patterns:** keywords for totals, headings and special sums.
- **Layout signals:** row has no unit, qty or rate; text in capitals; bold font; indentation; merged cells; item-number patterns such as `A`, `1.1`, `B.2`.
- **Position:** follows a heading; last row before a page total.
- **Statistics:** how numeric a column is.

A saved contractor template overrides the generic rules for that contractor.

---

## 8. Multiple quantity columns and pricing formats

### 8.1 Multiple quantity columns (`ItemQuantityColumn`, `BillQuantityLayout`)

Typical layouts have several quantity columns sharing one rate, e.g. `Tower A | Tower B | Total Qty` or `Type 1 Qty | Type 2 Qty`.

- **Mapping:** extra columns map to `additionalQtyCols: QuantityColumnMapping[]`, with name, `qtyCol` and optional `amtCol`. Names come verbatim from the column headings or the group heading above them.
- **Output:** each item gets `quantityBreakdowns: ItemQuantityColumn[]`, with one entry per column that has a value. `quantity` is the stated **Total Qty** column if the document has one.
- **When there is no stated total:** `quantity` is the sum of the columns. This is the Cost Library's own rule, not an invented value. It is marked as *derived* in the evidence, and the reconciliation report shows it.
- **When a stated total disagrees with the sum of its columns:** the row is flagged and nothing is corrected.
- **Export layout:** the workbook uses the header layout the Cost Library recognises: a group heading row above plain `Qty`/`Amount` pairs, or numbered `2 Qty`/`2 Amount`. This gives it the same column ids (`quantityColumnId`) so `BillQuantityLayout` is rebuilt correctly.

### 8.2 Different pricing formats

| Format in source | Handling |
|---|---|
| Single rate + amount | `rate`, `amount` (and `originalRate`, `originalAmount`) |
| Cost rate + tender rate (working files) | `baseRate`/`baseAmount` + `rate`/`tenderRate`; `profitPercent` only if stated |
| Profit %, discount columns | `profitPercent`, `rateAfterDiscount` only if stated |
| Several submissions side by side (e.g. "18 Months" / "24 Months") | **Pricing options**, each with its own rate/amount → `optionPrices: Record<optionId, OptionPrice>` plus `PricingOptionsSetting` names from the headings |
| "Rate Only" / "R.O." | `rateOnly: true`, rate kept, no quantity/amount invented |
| "Incl." / "Included" / "Excluded" / "By others" / "N/A" | Recorded as a special value in the evidence; amount left blank; flagged in reconciliation (the Cost Library has no field for it) |
| Lump sum (amount only) | Amount kept; quantity and rate left "not stated" (§6.3) |
| Provisional / Prime Cost Sums | `costScopeType`, amount kept |
| Profit / attendance % on PC/PS | §8.3 |
| Negative values (omissions, credits) | Kept negative in the converter; **flagged** because the Cost Library import turns them positive (§1.2) |
| Text numbers, currency symbols ("RM 1,250.00"), brackets for negatives | Parsed; raw text kept |

**Exporting pricing options:** I recommend **one upload workbook per option**. You would import the first, then add the others through the Cost Library's existing "add pricing option" import, which reads the same items. The other way is one workbook with side-by-side rate/amount pairs, which the Cost Library's sheet scan can also detect. Phase 6 will confirm which works reliably with a compatibility test (§15.3) before either is used.

### 8.3 Percentage items (profit and attendance on PC/PS)

These rows, e.g. "Allow for profit 1.5%", are linked to the sum above them, matching `percentageOf`. They are exported as the template describes: unit `%`, Qty = the percentage, rate and amount blank. The Cost Library then calculates the amount.

The **amount stated in the source document**, if there is one, is kept in the evidence. The reconciliation report compares it with the Cost Library's calculation.

---

## 9. How original values and references are preserved

### 9.1 Values

Every field value carries this record in the evidence:

```ts
interface FieldEvidence {
  raw: string | number | boolean | null;   // exactly as in the file
  status: 'parsed' | 'empty' | 'special' | 'unparseable' | 'derived' | 'user_entered';
  special?: SpecialValue;                  // 'INCLUDED' | 'RATE_ONLY' | 'PROVISIONAL_SUM' | …
  cells: CellRef[];                        // every source cell that contributed
  decidedBy: DecisionRecord;               // rule / template / user / (later) ai
}
```

- **`derived`** is only used for the Cost Library's own rules, such as quantity = sum of quantity columns. It is always shown in reconciliation.
- **`user_entered`** is only used for values you type in, such as the project year. These are recorded as your input and never presented as document data.

### 9.2 Descriptions

`description` is the item's own text, **verbatim**. Wrapped or continued lines are joined with a single space, and each part keeps its own cell reference. Heading and specification text stays in `mainHeading`, `subheading`, `secondarySubheading` and `parentSpecDescription`; it is **not** merged into the item's description.

Later, a ClaudeProvider may *suggest* a short `costItem` label or trade. Those suggestions go into the classification fields, are marked as suggestions, and **never replace `description`**.

### 9.3 Source references and the trace link

- **Inside the converter:** every row keeps the original `sourceFile`, a `sourceReference` in the Cost Library's own format (`"Sheet: Bill 3 | Row 214"`), and `sourceRowNumber`/`sourceSequence`. For PDFs it uses `"Page 12 | Line 31"`, with x/y position, plus OCR confidence for scans.
- **After upload:** the Cost Library sets `sourceReference` to the **export workbook's** sheet and row. The converter therefore gives every export row a fixed, known position, and the reconciliation workbook maps it back:

  `Export sheet + row  ↔  StagedBQRow id  ↔  original file + sheet + row (or page + position)`

  With this map, any item in the Cost Library can be traced back to the original document.
- **Possible improvement:** the Cost Library could be taught to read a "Source Reference" column. That would be a separate, optional change to the Cost Library, done only if you approve it. It is not part of this project.

---

## 10. Reusable contractor layout templates (Adjustment 3)

A **LayoutTemplate** is saved after you correct and approve a contractor's document layout. It records:

- **Who and what:** contractor (with aliases) and document type (BQ, working file or claim).
- **Fingerprint:** sheet-name patterns, header text of each column, column order, typical header row, number of pricing/quantity column groups, and words that appear on cover or collection pages.
- **Column mappings by header text** (not just column position), using the `ColumnMappingConfig` field names, plus quantity columns, pricing options and claim columns.
- **Row rules:** extra total and heading patterns, item-number style, and sheets to skip.
- **Housekeeping:** version, status (`draft` → `approved` → `retired`), approved by and when, and how many times it has been used and accepted.

When a new file is uploaded:
1. Templates are scored against the file's fingerprint. Above a threshold, the best match is **proposed**. You see what matched and what didn't.
2. If the layout has changed slightly (e.g. a new column), the differences are highlighted. The template is **never silently changed**. Saving your corrections creates a new template version.
3. Templates belong to an organisation, so other users in the same organisation can reuse them once the database phase starts.

---

## 11. Combining several files into one project BQ (Adjustment 5)

Typical cases:
- one file per bill
- separate files for building, M&E and external works
- a main BQ plus an addendum
- PDF bills mixed with Excel bills

A **MergePlan** lists each source (file → table regions → bill), the bill order (feeding `ProjectSettings.billOrder`, which the Cost Library builds itself on import) and how overlaps are resolved. The converter:

- **Detects overlaps:** the same bill number in two files, or the same bill + item number + description. Duplicates are **never added together**. You choose which source is authoritative, or mark one file as superseding the other (`DocumentRelationship: supersedes`).
- **Detects gaps and number clashes:** Bill numbers missing between files, or two different bills with the same number.
- **Keeps each row's own source file:** every row in the merged BQ keeps its own source, so reconciliation still works per file.
- **Checks totals per file and per bill.** The merged project total equals the sum of the included bills, with excluded or superseded items listed.
- **Keeps claims out of the merge.** Claim files cannot be merged into the BQ; they attach to it (§12).

---

## 12. Progress claims — a separate data model (Adjustments 5 & 6)

Claim data **is never stored in `FullBQItem`**. It is not uploaded to the Cost Library, because the Cost Library has no claim model. In particular `actualCost` is **not** filled from claims: a claimed or certified amount is not an actual cost.

```ts
interface ClaimDocument {
  id: string;
  projectId: string;
  sourceDocumentId: string;
  claimNumber: SourcedText | null;        // only if stated, e.g. "Progress Claim No. 5"
  periodEnd: SourcedText | null;
  claimDate: SourcedText | null;
  basis: 'claimed' | 'certified' | 'unknown';   // contractor's claim vs certified valuation
  relatedBqDocumentIds: string[];
}

interface ClaimLine {
  id: string;
  claimDocumentId: string;
  bqRowId: string | null;                 // link to StagedBQRow; null = unmatched (flagged)
  matchMethod: 'item_no+description' | 'template' | 'user' | 'ai_suggested_user_confirmed' | null;
  // What the claim says about the contract (for comparison only — never written to the BQ):
  statedContract: { quantity?: FieldEvidence; rate?: FieldEvidence; amount?: FieldEvidence };
  previous:   { quantity?: FieldEvidence; amount?: FieldEvidence; percent?: FieldEvidence };
  current:    { quantity?: FieldEvidence; amount?: FieldEvidence; percent?: FieldEvidence };
  cumulative: { quantity?: FieldEvidence; amount?: FieldEvidence; percent?: FieldEvidence };
  sources: SourceReference[];
  issues: ValidationIssue[];
}

/** Items with no BQ line: variations, day-works, materials on site, retention, deductions … */
interface ClaimAdjustment {
  id: string;
  claimDocumentId: string;
  kind: 'variation' | 'dayworks' | 'materials_on_site' | 'retention' | 'advance' |
        'previous_certificates' | 'deduction' | 'other';
  description: FieldEvidence;
  amount: FieldEvidence;
  sources: SourceReference[];
}
```

Checks:
- previous + current = cumulative
- cumulative quantity is not above the contract quantity
- the claim's stated contract rate or amount equals the BQ's (any difference is **reported, never corrected**)
- claim totals match the stated totals

Claims are exported to a **separate claims workbook**.

---

## 13. Interpretation provider (Adjustments 2 & 7)

### 13.1 What a provider may do

A provider can interpret **meaning**, not just positions:
- the document type and how documents relate (claim against BQ, working file of BQ, addendum, superseded)
- bill / section / Level 2 / heading hierarchy and heading levels
- what each column means, including unusual headings ("Qty Bldg A", "S/C rate", "Value to date")
- row classes, continuation lines, and which descriptive row is the parent specification
- construction terminology: identifying PC/PS, attendance, preliminaries, rate-only and lump-sum items
- **suggestions** for classification fields (`tradeWork`, `subTrade`, `costItem`, `element`, `materialCategory`, `structuralElement`), clearly labelled as suggestions
- matching claim lines to BQ rows

### 13.2 What a provider may never do

A provider **never supplies** a quantity, rate, amount, unit, item number or description. It returns **decisions that cite cells**. Code then copies the values from those cells.

```ts
interface CellRef { tableId: string; row: number; col: number }   // resolves to a SourceReference

interface Interpretation<T> {
  value: T;                       // a decision: a class, a field name, a level, a link …
  confidence: number;             // 0–1
  evidence: CellRef[];            // the cells this decision is based on (required)
  quotedText?: string[];          // text the provider says those cells contain
  reasoning: string;              // human-readable explanation
  method: 'rule-based' | 'ai' | 'template' | 'user';
  providerId: string;             // "rule-based@1.0.0", later "claude@…"
}

interface InterpretationProvider {
  readonly info: {
    id: string; version: string;
    kind: 'rule-based' | 'ai';
    displayLabel: string;         // "Conventional rule-based processing" | "AI interpretation (Claude)"
    capabilities: ProviderCapability[];   // which methods it really supports
    requiresNetwork: boolean;
  };
  classifyDocument(ctx: ProviderContext): Promise<Interpretation<DocumentType>>;
  relateDocuments(ctx: ProjectContext): Promise<Interpretation<DocumentRelationship>[]>;
  detectTableRegions(ctx: ProviderContext): Promise<Interpretation<TableRegion>[]>;
  mapColumns(ctx: ProviderContext, regions: TableRegion[]): Promise<Interpretation<ColumnRole>[]>;
  classifyRows(ctx: ProviderContext, map: ColumnPlan): Promise<Interpretation<RowClass>[]>;
  interpretHierarchy(ctx: ProviderContext, rows: RowClass[]): Promise<Interpretation<HierarchyAssignment>[]>;
  suggestClassifications(ctx: ProviderContext, rows: StagedBQRow[]): Promise<Interpretation<ClassificationSuggestion>[]>;
  matchClaimLines(ctx: ClaimContext): Promise<Interpretation<ClaimMatch>[]>;
}
```

### 13.3 The evidence verifier

Every interpretation, from any provider, passes through `core/evidence` before it is used. The verifier rejects:
- interpretations with no evidence
- references to cells that don't exist
- quoted text that doesn't match the cell
- values outside the allowed set

Rejected interpretations are logged and fall back to the rule-based result or to manual review. This is the technical guarantee that a future ClaudeProvider cannot introduce invented values.

### 13.4 Implementation now and later

- **RuleBasedProvider (now):** implements all methods with conventional rules and templates. `suggestClassifications` uses keyword rules only; it is optional and can be switched off.
- **ClaudeProvider (later, not built):** a server function (e.g. a Supabase Edge Function in the converter's own project) holds the API key and sends only the necessary excerpts. Responses are structured and checked with zod and the evidence verifier. An organisation-level setting controls consent to send documents. A **HybridProvider** can use rules first and ask Claude only about low-confidence decisions, which keeps cost down.

---

## 14. Additional data structures I recommend

These sit **around** `FullBQItem`; none replaces it.

| Structure | Why it's needed |
|---|---|
| `SourceDocument` | File identity, hash, format, uploader, organisation |
| `SourceReference` / `CellRef` | Exact location: sheet + row + cell, or page + line + position (+ OCR confidence) |
| `ExtractedTable` / `ExtractedRow` / `ExtractedCell` | One common raw format for every file type; kept for audit |
| `FieldEvidence` | Raw value, parse status and source cells for each field (§9.1) |
| **`StagedBQRow`** | `{ item: FullBQItem; evidence: Partial<Record<keyof FullBQItem, FieldEvidence>>; missing: (keyof FullBQItem)[]; rowClass; extraColumns: ExtraColumnValue[]; issues; approval }` |
| `ExtraColumnValue` | Source columns with no `FullBQItem` field (e.g. material/labour split), kept but not uploaded |
| `ColumnPlan` | Per table: a `ColumnMappingConfig`-compatible mapping plus claim columns and pricing options, with evidence |
| `LayoutTemplate`, `Contractor` | Reusable approved layouts (§10) |
| `DocumentRelationship` | claim_against, working_file_of, addendum_to, supersedes, duplicate_of |
| `MergePlan` | Combining files into one project BQ (§11) |
| `ClaimDocument`, `ClaimLine`, `ClaimAdjustment` | Separate claim model (§12) |
| `Interpretation<T>`, `DecisionRecord` | Provider decisions with evidence (§13) |
| `UserOverride` | Every correction, with before/after, who, when |
| `ValidationIssue` | Code, severity (info/warning/blocking), message, location |
| `ReconciliationReport` | Line trace, totals check, coverage, Cost Library import effects (§15.4) |
| `ExportBatch` | Files produced, export row ↔ StagedBQRow trace, who approved |

---

## 15. Export to Excel and upload into the Cost Library

### 15.1 What is produced

1. **Cost Library upload workbook.** It follows the **"BQ" template format** (Route B), because that format is the most predictable:
   - The columns are `No. | Bill | Level 2 Element | Main Heading | Subheading | Secondary Subheading | Item Description | Unit | Qty | Rate (RM) | Amount (RM)`.
   - Base Rate, Tender Rate, Profit %, Rate after Discount and extra Qty/Amount pairs are added only when used.
   - It contains **items only**. Subtotals, totals, collections and page totals are left out, as the template requires.
   - There is one row per item, in source order, with headings repeated on every row so the importer sets `headingLevels` correctly.
2. **Reconciliation workbook**, never uploaded. Its sheets are:
   - **Summary:** the totals check.
   - **Line Trace:** export row ↔ original file, sheet and row or page and position.
   - **Coverage:** every source row and what happened to it.
   - **Issues.**
   - **Cost Library Import Effects:** values the Cost Library will calculate, default or normalise.
   - **Extra Columns.**
   - **Overrides:** every manual correction.
3. **Claims workbook**, if there are claims. Separate, and not uploaded to the Cost Library.

### 15.2 Notes and descriptive rows

The template is items only. For non-item rows:
- **Headings** travel in the heading columns.
- **Parent specification text** becomes the nearest heading level.
- **Notes and preambles** are kept in the reconciliation workbook.

There is an optional setting to include notes as description-only rows, which the Cost Library treats as descriptive rows. Its exact effect will be confirmed by the compatibility test before it is offered.

### 15.3 Compatibility test

The converter's tests will run the **Cost Library's own import functions** (`parseBQWorkbookWithCustomConfig`, `analyzeUploadedBQWorkbook`) on the converter's export:
- They read from a pinned, read-only checkout of the Cost Library.
- They never modify it and never connect to its database.
- They use synthetic test data only.

The test then checks that:
- every exported item is read back as one `FullBQItem`
- bills, Level 2 elements, headings, quantity columns, rate-only items and percentage items come through as intended
- totals match
- any calculated, defaulted or sign-changed values are exactly the ones listed under "Cost Library Import Effects"

If the Cost Library's import changes later, this test catches it.

### 15.4 Upload procedure (manual, by you)

1. In the converter, approve the project BQ and export the files.
2. In the Cost Library, use the existing BQ import and upload the workbook, with the project name and year as in the converter.
3. Compare the Cost Library's import summary (`BQImportSummary`: bills, items, totals) with the converter's reconciliation Summary sheet. Both are shown side by side as a checklist in the converter.
4. Enter project information (type, location, GFA, measurements) in the Cost Library's Edit Project Info, as its template instructs.

---

## 16. Testing strategy

| Layer | Tool | What is tested |
|---|---|---|
| Unit | Vitest | Parsing, special values, unit text, header matching, row rules, quantity-column logic |
| Extraction | Vitest | Correct cells **and** correct sheet/row/cell or page/position references |
| Provider contract | Vitest | One shared suite every provider must pass, including evidence-verifier rejection tests |
| Templates | Vitest | Fingerprint matching, version changes, "never silently changed" |
| Merge | Vitest | Overlaps detected, duplicates never added together, per-file totals |
| Claims | Vitest | Claim processing leaves BQ rows byte-for-byte unchanged; previous + current = cumulative |
| Integration | Vitest | File(s) in → StagedBQRows + claims + reconciliation out |
| **Cost Library compatibility** | Vitest + read-only Cost Library checkout | §15.3 |
| Golden files | Vitest | Your anonymised real documents vs outputs you have checked |
| UI / end-to-end | Testing Library / Playwright (later) | Review, template save, export |

**"No invention" checks run on every fixture:**
- Every non-empty value traces to a source cell whose raw text contains it, or is marked `derived` / `user_entered`.
- Every output row has at least one source reference.
- Every source row appears in the coverage report.

**Test data:** generated synthetic files labelled *SYNTHETIC — NOT REAL COST DATA*, with obviously artificial descriptions and round dummy figures. Your real documents go only in the git-ignored private folder.

---

## 17. Technical risks and limitations

| Risk | Mitigation |
|---|---|
| **Cost Library import turns negative values positive** | Flagged as blocking-by-default; decision needed from you (§19) |
| **Cost Library import calculates or defaults values** (amount = qty × rate, rate = amount ÷ qty, trade, costItem, material category) | Exported cells match the source; every effect listed before upload; compatibility test |
| **Upload replaces source references** | Trace link in the reconciliation workbook (§9.3) |
| **The Cost Library's types or import may change** | Vendored type copy + check script + compatibility test |
| **Required number fields vs "not stated"** | Evidence keeps "not stated"; blank export cells; listed in reconciliation (§6.3) |
| **OCR accuracy on scans** | Confidence per value; values from scans always need review; image snippet shown |
| **PDF table reconstruction** | Position-based column detection anchored on headers; adjustable column boundaries |
| **Variety of contractor layouts** | Templates; editable rules; manual mapping |
| **Excel formulas without stored results** | Flagged; never recalculated |
| **Claim ↔ BQ matching where items are renumbered or reworded** | Unmatched lines flagged, never forced |
| **Multi-file overlaps or conflicts** | Never added together; user resolves |
| **Browser performance on large files or scans** | Web Workers, page-by-page processing, progress and cancel |
| **Rule-based limits** | Clearly labelled; confidence; review; ClaudeProvider later for ambiguous cases |
| **Future Claude API: cost and confidentiality** | Server-side key; minimal excerpts; organisation consent setting; usage limits |
| **This cloud session is temporary** | A GitHub repository for the converter is needed before Phase 2 |

---

## 18. Next stages (after approval)

1. **Phase 2 — Scaffold:**
   - set up Vite, React, TypeScript, Tailwind and Vitest
   - store the read-only copy of `costLibrary.ts` (with shim and check script)
   - write the converter models (§14) and the provider interface with the evidence verifier
   - create the RuleBasedProvider skeleton and the first parsing tests
2. **Phase 3 — Spreadsheets:** extraction, classification, mapping, row review, contractor templates.
3. **Phase 4 — Export & reconciliation:** upload workbook, reconciliation workbook, Cost Library compatibility test.
4. **Phase 5 — Multi-file merge and claims.**
5. **Phase 6 — Digital PDF; Phase 7 — Scanned PDF/OCR.**
6. **Phase 8 — Supabase (development project, converter schema only), multi-user.**
7. **Phase 9 — ClaudeProvider (optional).**

---

## 19. Decisions needed from you

1. **Negative values:** should rows with negative amounts block export until handled manually (recommended), or export as they are with a warning that the Cost Library will make them positive?
2. **Vendored types:** may I store a read-only copy of `costLibrary.ts` in the converter (recommended), refreshed only when you ask?
3. **Pricing options:** one upload workbook per option (recommended, subject to the compatibility test), or one workbook with side-by-side pricing?
4. **Notes and preambles:** keep them only in the reconciliation workbook (recommended), or also upload them as description-only rows?
5. **Classification suggestions** (trade, cost item, element): leave blank and let the Cost Library classify (recommended for now), or show rule-based suggestions for you to approve?
6. **Repository:** a new, empty GitHub repository for the converter.
7. **Example documents:** anonymised examples of each type (BQ, working file, claim; Excel and PDF), with expected results for at least one.
