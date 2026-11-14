# Decisions Record

Decisions approved by the project owner. Newest at the bottom. Each entry says what was decided and why, and when it takes effect.

---

## D-001 — Separate application
- The AI BQ Converter is a separate application in its own private repository, `hungzhen/ai-bq-converter`.
- It does not modify, connect to or deploy anything belonging to the Cost Library: its repository, its Supabase database or its Cloudflare deployment.
- Data reaches the Cost Library only when a person uploads an exported workbook through the Cost Library's existing import.

## D-002 — No AI provider in Phase 2
- The converter uses conventional rule-based processing only.
- No Anthropic API key is required, and no AI SDK is installed.
- A future ClaudeProvider must use the same provider interface and the evidence verifier described in `PHASE1_ARCHITECTURE.md` §13.

## D-003 — SheetJS source and version
- **Package:** SheetJS Community Edition **0.20.3**, from the official SheetJS CDN.
- **In `package.json`:** `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`.
- **Lock file:** `package-lock.json` records its integrity hash (`sha512-oLDq3jw7…`).
- **Not used:** the npm-registry `xlsx` 0.18.5, which is outdated and has published security advisories.
- **Network:** the cloud environment "ai-bq-converter" allows `cdn.sheetjs.com` for installation.
- **Check:** a test confirms the installed version is exactly 0.20.3.

## D-004 — Negative values
- Negative values are kept with their original sign.
- Any row containing a negative value **blocks export** until a person resolves it manually.
- Reason: the Cost Library import converts negative values to positive (`parseCleanRate` uses `Math.abs`).
- Takes effect: Phases 2D (parsing) and 4 (export).

## D-005 — Read-only copy of `costLibrary.ts`
- An exact copy of the Cost Library's `src/types/costLibrary.ts` is kept in the converter, with its original commit reference (`00491965`).
- It is never edited by hand; it is refreshed only on the owner's request.
- Takes effect: Stage 2B.

## D-006 — Pricing options
- One upload workbook per pricing option.
- Used only after the Cost Library compatibility test confirms it works.
- Takes effect: Phase 4.

## D-007 — Notes and preambles
- Notes and preambles go to the reconciliation workbook by default.
- They are not uploaded.
- Takes effect: Phase 4.

## D-008 — Trade, Cost Item and Element
- Rule-based suggestions are shown for the owner's review.
- **Only approved values** enter the upload workbook.
- Unapproved values stay blank.
- Takes effect: Phase 3 (suggestions and approval) and Phase 4 (export).

## D-009 — Stage-by-stage review
- Each stage is built, tested, committed and shown to the owner separately.
- The next stage starts only after approval.

## D-010 — TypeScript strictness setting (Stage 2B)
- The converter compiles in TypeScript `strict` mode.
- The extra setting `noUncheckedIndexedAccess` (switched on in Stage 2A) is **switched off**.
- Reason: the exact copy of `costLibrary.ts` does not compile with it (line 624), and the copy must not be changed. The Cost Library itself compiles without it, and without `strict` at all.
- Effect: code that passes the converter's stricter checks also satisfies the Cost Library's looser ones.
- Takes effect: Stage 2B.

## D-011 — How ambiguous cell values are handled (Stage 2D)
- **Number format:** the Malaysian convention. Comma = thousands separator, dot = decimal point, `RM` / `MYR` = Ringgit.
- **Ambiguous values are not guessed.** Comma decimals, unusual groupings, spaces inside numbers, trailing minus, both brackets and minus, scientific notation, units or currencies in the wrong column, foreign currencies: all get the state "unparseable", with the possible readings listed for a person to choose from.
- **Markers are not numbers.** `-`, `Nil` and `Incl.` are recorded as markers, not as zero. `L.S.` is not a quantity of 1.
- **Percentages:** a percentage in a Qty / Rate / Amount column is held back, because its meaning depends on the row (Phase 3 decides with the row's context). In a percentage column, a value between −1 and 1 written without `%` is flagged, because it could be a fraction.
- **Original kept:** the original cell value is always kept exactly.
- Details: `docs/VALUE_PARSING.md`.

## D-012 — "L.S." depends on the column (Stage 2E)
- **Unit column:** `L.S.`, `LS` and `Lump Sum` are kept exactly as written, as the unit meaning "lump sum".
- **Qty / Rate / Amount column:** the same text is a `LUMP_SUM` marker with no value.
- **Either way:** no quantity of 1 is ever assumed or filled in, and no rate is worked out from the amount.

## D-013 — Providers and the evidence verifier (Stage 2E)
- **One interface for every provider.** Rule-based now, AI possibly later.
- **Decisions only.** Providers return decisions that cite cells. They never return quantities, rates, amounts, units or descriptions; any answer containing them is rejected.
- **Phase 2 registry:** refuses AI providers and providers that need the network. No API key is used.
- **The verifier only reports.** It checks sources, project and document, that raw values are unaltered, and that parsed values match a fresh reading of the cell. It never corrects, fills in or approves anything.
- **Proposals until approved.** Every answer stays a proposal until a person approves it. Blocking findings can never be approved; warnings need an acknowledging note.
- Details: `docs/EVIDENCE_VERIFIER.md`.

## D-014 — Spreadsheet extraction (Stage 2F)
- **Accepted files:** only `.xlsx`, `.xls` and `.csv`.
- **Content decides the format.** If the name and the content disagree, the file is read by its content, with a warning.
- **Refused files:**
  - web pages or XML files saved with an Excel name
  - very old Excel 2–4 files
  - `.xlsm`, `.xlsb` and `.ods`
  - password-protected, empty and corrupted files
- **Values:** every cell keeps its raw stored value. Shown text and number format are kept separately and never replace it. Dates stay as their stored serial numbers.
- **Formulas:** never recalculated. A missing cached result gives no value, and evidence for it must be "missing". Values from formulas are flagged during verification.
- **Hidden content:** hidden and very hidden worksheets, rows and columns are extracted and marked.
- **Positions:** kept exactly from row 1 / column A, including blank rows.
- **Merged cells:** values under a merged range are kept, with a warning.
- **CSV:** read by the converter's own reader, keeping every field as exact text. Encoding and delimiter are detected only when reliable (at least 90% of rows agree); otherwise the user must choose. Non-UTF-8 text is read only when its encoding is chosen.
- **No classification:** extraction sets the document type to "unknown" and adds no column meanings, row types, classifications or calculations.
- Details: `docs/SPREADSHEET_EXTRACTION.md`.

## D-015 — First rule-based provider (Stage 2G)
- **Proposals only.** The provider proposes document type, table regions, column meanings, a row type for every row, the heading hierarchy and Trade / Sub-trade suggestions. Every answer cites cells with their exact text, explains itself, gives a confidence and lists alternatives when ambiguous.
- **Column meanings** use both the heading and the content below. When they disagree, the column is Unknown and both readings are offered.
- **Unknown when unsure.** Document type is Unknown without at least two distinct signals (three for a plain BQ). Hierarchy is left unresolved when no heading is above an item. Sub-trades come only from an item's own words.
- **Contract extended, not weakened.** New row types: title, column header, description-only item, Provisional Sum, Prime Cost Sum, percentage item, blank, unknown. New column roles: percentage, other, unknown. Answers may have verified alternatives, and table regions list repeated header rows. The verifier also checks Trade / Sub-trade labels against the Cost Library taxonomy.
- **Approval states:** proposed / verified / approved / rejected. Approving an answer with alternatives needs an explicit choice. Bulk approval covers only straightforward regions, columns and rows (no alternatives, no warnings). High confidence never approves anything.
- **Taxonomy reference:** `taxonomy.ts` re-exports only `UNIFIED_TRADE_PACKAGES` and `TRADE_SUBTRADES` from the read-only copy, as reference data. No Cost Library function is used.
- Details: `docs/RULE_BASED_PROVIDER.md`.

## D-016 — Pipeline and first interface (Stage 2H)
- **Local only.** Everything runs in the browser; nothing is uploaded, and the file is never changed.
- **Stops on failure.** The pipeline runs its stages in a fixed order and stops at the first failed stage with a clear message. A proposal that fails verification is shown as "failed verification" and can never be approved.
- **Complete source.** The whole extracted source is shown: every worksheet, including hidden ones, and every row in place. Proposed row types appear in a separate, dashed column.
- **Evidence.** Selecting a proposal shows its interpretation, confidence (always with its cited cells), explanation, exact quoted text, cell references (click to highlight), alternatives and findings.
- **Decisions:**
  - approve (a note is required with warnings; an explicit choice with alternatives; impossible with a blocking finding)
  - reject
  - reject with a correction (verified against the same cells and stored separately, with a note)
  - leave unresolved
- **Bulk approval:** Stage 2G restrictions, with a confirmation step.
- **Identity:** the reviewer's name is recorded when typed; otherwise "not recorded". There is no account system.
- **No saving yet.** Review decisions are kept in memory only, for this session. (Superseded by D-017.)
- Details: `docs/USER_INTERFACE.md`.

## D-017 — Review persistence and recovery (Stage 2I)
- **The review is saved, not the document.** A saved review holds the document's identity (name, size, SHA-256 fingerprint, worksheets), the original proposals with their evidence and verification, the decisions, notes, chosen alternatives, corrections, the reviewer name and the extraction settings. It does not hold the file's contents.
- **Browser only.** Saved in this browser's IndexedDB (memory only if IndexedDB is unavailable). Nothing is sent anywhere. Clearing browser data deletes saved reviews, so backups are encouraged.
- **Reopen needs the same file.** The fingerprint must match; the file name never decides. On a match the file is re-extracted with the saved settings and every saved proposal is re-verified. If anything no longer fits, nothing is restored. On a mismatch, the old review is kept and the user may start a new, separate review.
- **History is append-only.** Every creation, approval, rejection, correction, chosen alternative, acknowledged warning, reopening, restore and import is recorded with time, name (or "not recorded") and note. Changing a decision means reopening it; the earlier decision stays.
- **Backups.** JSON file (`*.review-backup.json`) labelled "NOT a Cost Library upload workbook", with a SHA-256 checksum. Import refuses empty, spreadsheet, non-JSON, other, wrong-version, incomplete, altered or damaged files. An import whose review id already exists is added as a copy; nothing is overwritten.
- Details: `docs/REVIEW_PERSISTENCE.md`.
