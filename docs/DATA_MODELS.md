# Core Data Models (Stage 2C)

This is a plain-English guide to how the converter records information. The code is in `src/core/models/`.

## 1. Source documents and references (`source.ts`)

A **SourceDocument** is one uploaded file. It records:
- the file name, exactly as uploaded
- the format: XLSX, XLS, CSV or PDF
- the document type: standard BQ, contractor working file, progress claim, summary only, or unknown
- a SHA-256 fingerprint of the file's contents
- who uploaded it, and when

A project can hold any number of documents (see §5).

A **SourceReference** points to one exact place in one document. Every reference carries the file name and document type, so it makes sense on its own.

| Kind | Records | Example (Cost Library format) |
|---|---|---|
| Excel worksheet | worksheet name (exactly as in the file), sheet position, row, column, cell address | `Sheet: Bill 3 \| Row 214` (cell `E214`) |
| CSV | line and field number | `Row 12` |
| PDF | page, line, position on the page (in points), PDF text or OCR, OCR confidence | `Page 3 \| Line 14` |

## 2. Field evidence (`evidence.ts`)

Every value is stored with its **evidence**:
- the **raw** value, exactly as in the document
- the **parsed** value
- the **source reference(s)**
- the **extraction method** (Excel cell, CSV field, PDF text, OCR, entered by a person, worked out by a stated rule, or created by the system)
- the **verification status** (unverified, automatically checked, confirmed by a person, corrected by a person, or rejected)

The **state** says exactly what was found:

| State | Meaning | Parsed value |
|---|---|---|
| `value` | A real value was read. Negative values keep their sign | the value |
| `zero` | The document explicitly shows zero ("0", "0.00") | `0` |
| `blank` | The place exists (e.g. the Qty cell) but is empty | none |
| `not_stated` | The document has no place for it at all (e.g. no Rate column) | none |
| `missing` | The place should exist but could not be read | none |
| `unparseable` | Text is there but can't be understood; the text is kept | none |
| `special` | A marker such as "Incl." or "Rate Only" | none |

Only `value` and `zero` have a parsed value. "Nothing" is never turned into 0. The converter rejects any evidence that breaks these rules.

## 3. Staged BQ row (`stagedBQRow.ts`)

A **StagedBQRow** holds the Cost Library's own **FullBQItem**, with its interface unchanged, plus:
- the evidence for each value
- every source row that contributed (e.g. an item and its continuation lines)
- **placeholders** (see the gaps rule below)
- **proposals** for Trade, Cost Item and Element, which stay blank until a person approves them (D-008)
- **issues**, each with a severity: info, warning, or blocking
- the **review status** (pending review, needs changes, approved, rejected), with its history

**Rules for values:**
- Every value in the FullBQItem comes from evidence.
- `originalRate` and `originalAmount` are set only from the document's own rate and amount.
- `actualCost` is never filled.
- The unit is kept as written, for example `m2`, not converted to `m²`.

**Gaps are never silent.** FullBQItem *requires* a description, unit, quantity, rate and amount. When the document doesn't give one:
- the field holds 0 or empty text
- this is **recorded as a placeholder**, with the reason (blank, not stated, missing…)
- it is **reported as an issue**: a warning for priced items, information for headings

A quantity of **zero shown in the document** is a real value. It is not a placeholder.

**Negative values keep their sign.** They create a **blocking** issue (D-004). A blocked row cannot be approved until a person resolves the issue with a note. Resolving records who resolved it, when and why. It never changes the value.

**Project year.** The project year is typed in by a person. Until then the row has a blocking issue. It is never assumed.

**Integrity check.** `checkStagedRowIntegrity` confirms that every value matches its evidence. Rows cannot be changed in place; each change creates a new row and leaves the old one as it was.

## 4. Progress claims (`progressClaim.ts`)

Claim data is a separate model.

| Record | Holds |
|---|---|
| **ClaimDocumentRecord** | Claim reference, claim date, period end and contractor. Basis (claimed or certified). Certification: certificate reference, date, certifier and certified amount. Adjustments such as retention, variations and materials on site, with negative values kept |
| **ProgressClaimRecord** | One claim line: the item as the claim writes it. Previous, current and cumulative figures for claimed quantity, claimed amount, percent complete, certified quantity and certified amount. Contract figures shown in the claim, kept *for comparison only*. The link to the BQ row |

**Separation rules:**
- The claim file never imports FullBQItem or the BQ row type. A claim line refers to its BQ row **only by the row's id**.
- Linking, confirming and comparing only *read* the BQ row.
- A difference between the claim's contract figures and the BQ is **recorded on the claim**. The BQ is never corrected from a claim.
- If previous + current ≠ cumulative, this is reported and the figures stay as written.
- Claim values never go into FullBQItem's quantity, rate, amount, original figures or `actualCost`.

## 5. Project (`project.ts`)

A **ConverterProject** holds:
- the project name
- the project year, entered by a person in the format `2024 Q1`
- **all its source files**
- the relationships between them, such as "claim against BQ", "working file of", "addendum to", "supersedes" or "duplicate of"

It can:
- check that every reference points to one of its own files, with a matching name and type
- report the same file uploaded twice

## 6. Issues and review (`issues.ts`, `review.ts`)

**Issue codes:**

| Code | Meaning |
|---|---|
| `REQUIRED_FIELD_NOT_IN_SOURCE` | A required FullBQItem field has no value in the document |
| `PROJECT_YEAR_NOT_ENTERED` | The project year hasn't been entered |
| `NEGATIVE_VALUE` | A negative figure |
| `UNPARSEABLE_VALUE` | Text that couldn't be understood |
| `SOURCE_VALUE_MISSING` | A value that should be there couldn't be read |
| `SPECIAL_VALUE` | A marker such as "Incl." instead of a figure |
| `CLAIM_ARITHMETIC_MISMATCH` | Previous + current ≠ cumulative in a claim |
| `CLAIM_NOT_LINKED` | A claim line not yet linked to a BQ row |
| `CLAIM_CONTRACT_FIGURE_DIFFERS` | A contract figure in a claim differs from the BQ |

Every review decision is kept with who made it, when, and an optional note.
