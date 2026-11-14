# Draft Rows (Stages 2J–2K)

A plain-English guide to the **Draft rows** tab: the draft Cost Library rows (`FullBQItem`, wrapped in `StagedBQRow`) built from your approved decisions.

**Draft rows only.** Nothing is exported or uploaded. Drafts are not saved separately: they are rebuilt from your saved decisions each time, so they always match them. To change a draft, change the decision behind it in the review; the change is kept in the history.

## What is used

- **Only decisions you approved, or corrections you recorded.** Undecided proposals block their table. Rejected proposals are never used.
- **Values copied, never worked out.** Every value is copied from its own cell, exactly as the earlier stages read it:
  - The value rules (D-011, D-012) are unchanged.
  - Nothing is calculated: no quantity × rate, no extension, no total, no missing figure.
  - Totals written in the document are listed for information only.

## The six decisions

1. **Placeholder 0 is never a real zero.** If the document gives no quantity, rate or amount, `FullBQItem` still needs a number, so the draft holds 0 **as an internal placeholder only**.
   - It is listed as a placeholder, and its evidence says what was found (empty cell, "-", "Rate Only", "Nil" …).
   - It raises a **blocking** issue.
   - A "0" written in the document is a genuine zero. It is shown as "stated as 0 in the document" and has no placeholder.
2. **Lump sums.** A lump-sum unit ("LS", "L.S.") with no quantity keeps its quantity "not stated". It is never set to 1, and the rate is not worked out from the amount.
3. **Project name and year.** You type them in on the Draft rows tab; they are never taken from the file name. Until then, drafts still appear but every row has **blocking** issues. Saving them adds a "project details changed" entry to the review history.
4. **Units.** Kept exactly as written ("M2", "sq.m"). The Cost Library's spelling ("m²") is shown beside the unit and never applied.
5. **Unclassified rows.** These are not drafted and are listed with a warning:
   - rows whose type is "unknown"
   - rows whose proposed type was rejected without a correction
   - rows that never had a proposal

   Their type is never guessed.
6. **Tables are independent.** Each table needs its own table area, column meanings, row types and heading levels decided. A blocked table shows its reasons and never stops another, ready table.

## Continuation rows

- **Joining.** A continuation row is joined to the item that the approved heading levels say it belongs to. The texts are joined with one space, each exactly as written.
- **Evidence kept.** Every contributing cell is kept in the draft ("joined from 2 cells"), and the joined description is checked against those cells again (`verifyDrafts`).
- **Not attached by guesswork.** If it has not been decided which item a continuation belongs to, its table is blocked.
- **Other values not used.** Values on a continuation row outside the description column, such as a quantity, are not used. They raise a **blocking** issue on the item.

## Every source row is accounted for

Each table shows **Source rows: N**, split into:

- draft rows
- item rows of a blocked table
- continuation rows (joined)
- column headings
- headings (used as context)
- notes / preambles
- totals / carried
- titles / references
- blank rows
- ignored rows
- unclassified rows
- rows outside the table area
- undecided rows
- rows of tables not converted

The counts always add up to the number of rows in the worksheet. "Every other source row" lists each one and says what happened to it.

## Other checks

- **Negative values** keep their sign and raise a **blocking** issue (D-004).
- **Item numbers and descriptions** are copied exactly.
- **Headings** (bill, section, main, subheading) come only from the approved heading levels. If a heading's text cannot be identified without guessing, the field is left blank, with a warning.
- **Trade, Sub-trade, Cost Item and Element** are filled only from suggestions you approved (D-008). Otherwise they stay blank.
- **Progress claims** are never turned into BQ rows. A claim column in a table blocks that table.
- **Not yet supported:** additional quantity or amount columns, undetermined percentage columns, and Element, Trade or Cost Item columns. A table that uses one is blocked, not guessed.
- **Click to source.** Clicking any value shows its source cell in the review view.

## Older reviews

Reviews and backups saved by Stage 2I still load, import and reopen; they need no conversion. Their project details read as "not entered" until you type them in.

![Draft rows, project details entered](screenshots/15-draft-rows-ready.png)

![A draft value shown in its source cell](screenshots/17-draft-value-source-cell.png)

## Your decisions about draft rows (Stage 2K)

You decide about each draft row in its **Decide / resolve…** panel. Nothing you decide changes a value, and nothing is exported yet.

### Resolving blocking issues

Each blocking issue is resolved on its own, with a note:

| Issue | What you can do |
|---|---|
| Placeholder quantity, rate or amount | **Confirm: … is not stated in the document — leave blank.** The value stays a placeholder, and the screen shows "confirmed: stays blank in the export". It is never a zero or a supplied figure. |
| Values on a continuation row not used | **Confirm: the continuation-row values are not part of this item.** |
| Negative value | Cannot be resolved. The row can only be **excluded from the upload**. Its value stays negative (for example -200) and stays listed with its evidence. |
| Project name or year missing | Cannot be resolved with a note; enter them. |

A resolution can be withdrawn while the row is not approved. The earlier resolution stays in the history.

### Deciding a row

- **Approve row:** only when every blocking issue is resolved. If the row has warnings, your note acknowledges them.
- **Needs changes:** marks the row for another look.
- **Exclude from upload:** needs a reason. The draft row is not deleted or changed. It stays listed under "Excluded from the upload" with its original values, source reference, reason and history.
- **Change this decision:** reopens the row. The earlier decision stays in the history.
- **Approve rows with no issues…:** approves, after a confirmation, only rows with no issues at all.

Each table shows how many rows are approved, excluded, needing changes, not yet decided and outdated, and whether it would be **ready for export**: every row approved or excluded, and the project details complete. Nothing is exported in Stage 2K.

### Outdated decisions

Every resolution and decision remembers a fingerprint of the row's source-derived content: its values, evidence, cells, issues, headings and trade labels. If you later change a review decision so that a row changes, its earlier resolutions and decision become **outdated**:

- the row turns amber and is marked "⚠ Outdated — redo";
- the panel shows exactly what changed (for example, Amount: "400" → "not stated (no column)");
- you must resolve and decide again. The earlier records stay in the history.

Entering or changing the project details does not make decisions outdated: they are not source-derived. Decisions for rows that are no longer draft rows (for example, a row you re-classified as a note) are listed as not applied.

The filter **Show** narrows the list to rows with unresolved blocking issues, rows not yet decided, excluded rows, or outdated rows.

Reviewer names are typed in, not verified. The history is append-only through the app, but it is not tamper-proof.

![Resolving issues and deciding rows](screenshots/19-row-decisions.png)

![Excluded negative row, kept with its value](screenshots/20-excluded-negative.png)

![An outdated approval with what changed](screenshots/21-outdated-approval.png)

