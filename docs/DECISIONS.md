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

## D-017 — Review persistence and recovery (Stage 2I, with hardening)
- **The review is saved, not the document.** A saved review holds the document's identity (name, size, SHA-256 fingerprint of the complete file bytes, worksheets), the original proposals with their evidence and verification, the decisions, notes, chosen alternatives, corrections, the reviewer name and the extraction settings. It does not hold the file's contents.
- **Browser only.** Saved in this browser's IndexedDB (memory only if IndexedDB is unavailable). Nothing is sent anywhere. Clearing browser data deletes saved reviews, so backups are encouraged.
- **Reopen needs the same file.** The fingerprint must match; the file name never decides. On a match the file is re-extracted with the saved settings, every saved proposal is re-verified and the whole record is checked. If anything does not fit, nothing is restored. On a mismatch the old review is kept, and the user may start a new, separate review.
- **History is append-only through the application, and is NOT tamper-proof.** The app records every creation, approval, rejection, correction, chosen alternative, acknowledged warning, reopening, restore and import with time, name and note, and never edits or removes an entry. The records live in the browser and in backup files, where they can be edited outside the app. The checks detect inconsistent or damaged records, but a careful, fully consistent edit cannot be detected. **The history is not a secure audit trail.**
- **Reviewer names are typed in by the user.** They are not authenticated identities; there is no sign-in.
- **Every saved review is checked when loaded** (structure, decision rules, history consistency). An invalid record is listed with its reasons, cannot be opened, and is kept exactly as stored. It is never deleted, overwritten, repaired or approved automatically. It can be exported as it is, or deleted by the user after confirmation.
- **Backups.** A JSON file (`*.review-backup.json`) labelled "NOT a Cost Library upload workbook", with a SHA-256 checksum.
  - **The checksum is an ordinary hash, with no secret key and no signature.** It detects accidental changes and damage. It does not prevent deliberate tampering, because anyone can recalculate it after editing.
  - On import the review must also pass every check: approval eligibility, warning acknowledgements and notes, chosen alternatives, corrections, and history consistency with the current decisions. Anything that fails is refused with the reasons. The backup file is only read.
- **Duplicate imports.** A backup is recognised by its review id and by its content fingerprint (the backup checksum, recorded in the "imported" history entry). If it matches a saved review, the import stops with a warning. The user may cancel, or deliberately import it as a separate copy with a new id.
  - New reviews are stored with an atomic IndexedDB `add`, so simultaneous imports can never overwrite an existing review or each other.
- Details: `docs/REVIEW_PERSISTENCE.md`.

## D-018 — Draft rows from approved decisions (Stage 2J)
- **Draft rows only.** Draft Cost Library rows (`StagedBQRow` wrapping `FullBQItem`) are built from **approved** decisions (or recorded corrections). Nothing is exported or uploaded. Drafts are not stored; they are rebuilt from the saved decisions, so they can never drift from them.
- **Values copied, never calculated.** Each figure and text comes from its own cell, read by the Stage 2D parsers (D-011, D-012 unchanged). No quantity × rate, extension, total or missing figure is ever worked out. Totals stated in the document are listed for information only.
- **Decision 1, placeholders:** a required quantity, rate or amount the document does not give is held as 0 **only as an internal placeholder**. Its evidence states what was found, it is listed as a placeholder, and it raises a **blocking** issue. A "0" written in the document has state "zero" and no placeholder. The two are shown differently everywhere. (This makes `REQUIRED_FIELD_NOT_IN_SOURCE` blocking for quantity, rate and amount, a change to the Stage 2C model.)
- **Decision 2, lump sums:** the quantity stays "not stated". Quantity 1 is never assumed, and the rate is not worked out from the amount.
- **Decision 3, project details:** the project name and year are typed in by a person and never inferred (for example, from the file name). Drafts appear before they are entered, with **blocking** issues.
  - Project details are saved in the review, with a "project details changed" history entry.
  - The project reference and location are optional.
- **Decision 4, units:** units are kept exactly as written. The Cost Library's spelling (its own `normalizeUnit`, re-exported read-only in `src/vendor/cost-library/units.ts`) is shown beside the unit and never applied.
- **Decision 5, unclassified rows:** rows whose type is unknown, rejected without a correction, or never proposed are not drafted. They are listed in the reconciliation information, and their type is never guessed.
- **Decision 6, tables:** every table is checked on its own: its table area, columns, row types and heading levels must be decided. A blocked table never stops a ready table.
  - The document type is decided once for the whole document.
  - A progress claim or a summary-only document is never converted.
- **Continuation rows:** joined to their item (as decided by the approved heading levels) with one space. Every contributing cell is kept and checked again (`verifyDrafts`). Values on a continuation row outside the description are not used, and raise a blocking issue.
- **Every source row is accounted for:** each row is drafted, joined, heading, note, total, header, title or reference, blank, ignored, unclassified, outside the table area, undecided, item in a blocked table, or table not converted.
- **Not yet supported (a table that uses them is blocked, not guessed):**
  - additional quantity or amount columns
  - percentage columns of undetermined purpose
  - Element, Trade and Cost Item columns
  - claim columns, which are never mixed into BQ rows
- **Backward compatibility:** reviews and backups saved by Stage 2I need no conversion and still load, import and reopen. Their project details read as "not entered". The review format version stays 1.
- Details: `docs/DRAFT_ROWS.md`.

## D-019 — Resolving issues and approving draft rows (Stage 2K)
- **Decisions about draft rows, not changes to them.** Resolutions and row decisions are saved in the review (`draftRows`) with history entries. No value is ever changed. Nothing is exported.
- **Decision 1, placeholders:** a placeholder quantity, rate or amount is resolved only by confirming, with a note, that the document does not state it. It stays blank in the eventual export. It is never shown or stored as a zero or a supplied figure; the value stays a placeholder.
- **Decision 2, negatives:** option (a). A negative value cannot be resolved, and such a row cannot be approved. It can only be excluded from the upload, with a reason. It keeps its negative value (for example -200 stays -200) and its source evidence in the reconciliation. Nothing is ever turned positive.
- **Decision 3, bulk approval:** only rows with no issues at all, after an explicit confirmation step.
- **Decision 4, outdated decisions:**
  - Each resolution and row decision stores a SHA-256 fingerprint of the row's source-derived content (values, evidence, sources, issues, headings, trade labels, description parts) and a readable summary.
  - If a changed review decision alters the row, those records become outdated. They are shown in amber with what changed, and must be redone. The earlier ones stay in the history.
  - Project details and dates are not source-derived, so changing them does not make decisions outdated.
  - Decisions for rows that no longer exist are listed and not applied.
- **Decision 5, warnings:** blocking issues are resolved one at a time. Warnings are acknowledged by the note given when the row is approved.
- **Always:**
  - A row with an unresolved blocking issue is never approved; an approval stored against such a row is shown as not valid.
  - Excluding a row needs a reason and never deletes or alters the draft row. Excluded rows stay listed with their original values, sources, reason and history.
  - Missing project details are never resolved with a note; they must be entered.
- **Integrity:** the load and import checks cover row decisions, including rules that need no file and consistency with the history. Reviewer names are typed in and not verified. The history is append-only through the app but is not tamper-proof.
- **Compatibility:** Stage 2I and 2J reviews and backups load and reopen unchanged, with no row decisions until a reviewer makes them. The review format version stays 1.
- **Stage 2L (planned):** the Cost Library upload workbook and the reconciliation workbook. The Cost Library import compatibility test will be proposed separately and needs explicit approval.

