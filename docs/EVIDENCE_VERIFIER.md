# Provider Interface and Evidence Verifier (Stage 2E)

This is a plain-English guide to how interpretations and values are checked before anyone can approve them. The code is in `src/providers/` and `src/core/evidence/`.

## 1. Providers

A **provider** is anything that interprets a document. One interface (`src/providers/types.ts`) serves:
- the conventional **rule-based provider** (Stage 2G)
- a possible **AI provider** later (design notes only: `src/providers/claude/README.md`)

**What a provider may do.** Decide document type, table regions, what each column means, what each row is, the heading hierarchy, how documents relate and which claim line matches which BQ row. It may also *suggest* Trade, Cost Item or Element labels.

**What a provider may never do.** Supply a quantity, rate, amount, unit or description. The decision types have no place for them. Figures and text are always copied from the cited cells by the converter's own parser (Stage 2D).

**What every answer must have:**
- the cells it relied on (`evidence`)
- optionally, the exact text it read from them (`quotedText`)
- a confidence between 0 and 1
- a reason
- its provider's stamp
- the status **"proposed"**

**The registry** (`src/providers/registry.ts`) enforces the current policy. In Phase 2:
- AI providers are refused
- providers needing the network are refused
- labels must match the kind: rule-based results are labelled *"Conventional rule-based processing"*; AI results would be labelled *"AI interpretation — proposal only, requires approval"*

No API key and no external service is used. Claude Pro and Claude Code are development tools only.

## 2. The evidence verifier: values (`verifyEvidence.ts`)

For every value, the verifier checks:

| Check | Fails with |
|---|---|
| The evidence record is internally consistent | `INCONSISTENT_EVIDENCE` |
| Each source belongs to this project, with the right file name and type | `SOURCE_NOT_IN_PROJECT` |
| Each source is in the expected document | `WRONG_DOCUMENT` |
| The cited cell really exists | `SOURCE_CELL_NOT_FOUND`, `SOURCE_ROW_NOT_FOUND` |
| The recorded raw value is **exactly** the cell's value | `RAW_TEXT_ALTERED` |
| Re-reading the cell with the parser gives the same state, value and marker | `PARSED_VALUE_MISMATCH` |
| "Missing" is not recorded for a cell that exists | `CONFLICTING_EVIDENCE` |
| A person has not rejected it | `REJECTED_EVIDENCE` |

The re-reading check is what catches a blank turned into zero, a dash turned into zero, `L.S.` turned into a quantity of 1, or an ambiguous `1,25` recorded as a clean number.

**Flagged for a person's attention (warnings):**
- missing, unparseable and **ambiguous** values (with the possible readings listed)
- negative values
- OCR confidence that is low (below 80 %) or not recorded
- values worked out by a rule

**Reported for information:**
- blank, not stated
- markers such as "Incl."
- values entered by a person
- values combined from several cells

**Whole records:**
- `verifyStagedBQRow` adds the row's integrity check and its project, document and source-row checks. It also catches a row marked approved while a blocking issue is unresolved.
- `verifyProgressClaimRecord` checks every claim figure, and that a linked BQ row exists.

## 3. The evidence verifier: provider answers (`verifyInterpretation.ts`)

An answer is **rejected** when it:
- is not a proposal (for example, it claims to be approved)
- cites no cells, or cites tables, rows, cells or documents that don't exist, aren't in the project, or are in the wrong document
- cites cells that don't cover the decision (a column decision with no cell in that column; a row decision without that row; uncited header rows)
- quotes text that differs from the real cell; spacing differences are noted but accepted, capital letters are not
- contains **any field the decision type doesn't have**, such as an invented quantity, rate, amount, unit or description
- has an invalid value: unknown role, row class, level or document type; a parent after its row; a back-to-front data range; a relationship of a document with itself
- gives a classification label that looks like a figure (`1,250.00`, `5%`, `(50.00)`)
- has a confidence outside 0 to 1, or doesn't match the provider that produced it

Low confidence (below 0.5) and missing reasoning are flagged. Every AI answer is marked as needing a person's approval.

## 4. Proposals (`proposals.ts`)

```
provider answer → verifier → proposal ("proposed") → a PERSON approves or rejects
```

- **Bound to one answer.** A proposal is created with the verifier's report for *that exact answer*. If the answer changes, the report no longer fits and approval is refused.
- **Blocking findings:** the proposal can never be approved, not even with a note.
- **Warnings:** approval needs a note that acknowledges them.
- **Passing the verifier is not approval.** Nothing is approved automatically.
- **Only approved decisions** can be used by later stages (`approvedDecisions`).

## 5. Provider contract (`tests/contract/providerContract.ts`)

These are shared tests that every provider must pass: the test provider now, the RuleBasedProvider in Stage 2G, and any future AI provider. Every provider must:
- identify itself correctly
- need no network (if rule-based)
- return only stamped proposals
- cite cells for every answer
- pass the verifier
- never supply a figure, unit or description
