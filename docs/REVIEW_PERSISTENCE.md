# Review Persistence and Recovery (Stage 2I)

Plain-English notes on how reviews are saved, reopened and backed up. Everything stays **in your browser**. Nothing is uploaded.

## What is saved

A **saved review** (`src/core/review/reviewRecord.ts`) contains:

- the document's identity: file name, size, type, worksheets, and its **fingerprint** (SHA-256 of the file's bytes)
- the extraction settings (for example, the CSV delimiter)
- every original proposal, with its evidence (cited cells, quoted text) and verification report
- the decisions: approved / rejected / unresolved, notes, acknowledged warnings, chosen alternatives and corrections
- the reviewer name (or "not recorded") and the provider (`rule-based@0.1.0`)
- an append-only **history** of every change

It does **not** contain the file's contents. To reopen a review you choose the original file again.

## Where it is saved

The data goes into the browser's built-in database (IndexedDB), in a database called `ai-bq-converter` (`src/storage/reviewStore.ts`). It is saved automatically after every decision.

- It belongs to this browser and this browser profile. Another browser or computer does not see it.
- Clearing site data, private/incognito windows, or the browser's own storage limits can remove it. **Export a backup** of reviews you want to keep.
- If IndexedDB is not available, reviews are kept in memory only, and the app says so.

## Reopening a review

1. Click **Reopen** and choose the original file.
2. The file's fingerprint is compared with the saved one. **A matching file name is not enough.** If they differ, nothing is restored. The saved review is kept, and you may review the new file as a separate review.
3. If it matches, the file is read again with the saved settings, and **every saved proposal is re-verified** against it (`src/core/review/restore.ts`). Decisions are checked too. For example, an approval with warnings must have a note. If anything does not fit, nothing is restored and the reasons are shown.
4. A "review restored" entry is added to the history.

Choosing a file that already has a saved review offers **Continue this review** or **Start a new, separate review**.

## Decision history

Each entry has a sequence number, time, name, action and note, plus the decision before and after. Actions:

- review created
- proposal created
- approved
- rejected
- correction recorded
- alternative chosen
- warning acknowledged
- decision reopened
- review restored
- review imported

Entries are never edited or removed. To change a decision, **Change this decision** reopens it, and the earlier decision remains in the history.

## Backup export and import

- **Export review backup** downloads `<file name>.review-backup.json` (`src/core/review/backup.ts`). It contains the whole saved review, a notice that it is **NOT a Cost Library upload workbook**, and a SHA-256 checksum. It contains no recalculated or new BQ figures.
- **Import review backup…** checks the file and refuses, with a reason:
  - an empty file
  - a spreadsheet
  - text that is not JSON
  - another kind of JSON
  - a different format version
  - missing parts (for example, no fingerprint or history)
  - proposals that no longer match their verification
  - a changed or damaged file (checksum)
- An imported review whose id already exists is added as a **copy** with a new id. Nothing is overwritten. An "imported" entry is added to the history.
- An imported review still needs the original file to reopen.
