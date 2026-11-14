# Spreadsheet Extraction (Stage 2F)

A plain-English guide to how `.xlsx`, `.xls` and `.csv` files are read. The code is in `src/core/extraction/`.

Extraction only **reads**. Every cell's original value and exact position is kept, so later stages and the evidence verifier can trace any value back to it.

Extraction does **not**:
- decide what a column or row means
- assign Trade, Cost Item or Element
- calculate anything
- change units or descriptions
- remove notes, blank rows, duplicates or unusual rows
- join continuation lines

It never changes the uploaded file.

## 1. Which files are accepted

The file name must end in `.xlsx`, `.xls` or `.csv`. Capitals don't matter. Then the **content** decides:

| Content | Read as |
|---|---|
| ZIP container | Excel 2007+ workbook |
| OLE compound file | Excel 97–2003 workbook, or a password-protected workbook |
| Text (`.csv` only) | CSV |

If the name and the content disagree (e.g. an `.xlsx` saved as `.xls`), the file is read by its content and a **warning** says so.

**Refused with a clear message:**

| File | Error |
|---|---|
| Any other type (`.xlsm`, `.xlsb`, `.ods`, `.pdf`, `.txt`…) | `UNSUPPORTED_FORMAT` |
| An empty file | `EMPTY_FILE` |
| A password-protected workbook | `PASSWORD_PROTECTED` |
| A damaged workbook (truncated, random bytes, a ZIP that isn't a workbook such as a `.docx`) | `CORRUPTED_FILE` |
| A web page or XML file saved with an Excel name; a very old Excel 2–4 file | `UNSUPPORTED_FORMAT` |
| An Excel workbook named `.csv` | `FORMAT_MISMATCH` |

## 2. Excel workbooks

**Worksheets**
- **Every worksheet** is read, in the original order, with its exact name.
- **Hidden** and **very hidden** worksheets are read too, and their visibility is recorded. A note says so.
- An empty worksheet is listed and reported, not dropped.

**For every cell present in the file:**

| Kept | Example |
|---|---|
| File, worksheet, worksheet position | `SYNTHETIC_BQ.xlsx`, `Bill 2 – Substructure`, 2nd sheet |
| Cell address, row and column number | `E7`, row 7, column 5 |
| **Raw value**: exactly as stored | `-12.5` |
| Cell type | number, text, boolean, error, empty |
| **Shown text**: kept separately, never replaces the raw value | `(RM 12.50)` |
| Number format | `"RM" #,##0.00;("RM" #,##0.00)` |
| Formula and its cached result | `=D5*E5`, cached `255` |
| Formula without a cached result | flagged; **no value** (raw is empty) |
| Merged range; whether it is the top-left cell | `B4:F4`, origin / covered |
| Hidden row / hidden column | marked |
| Date-formatted number | kept as the stored serial number, marked as a date |
| Excel error | kept as its text, e.g. `#DIV/0!` |

**Positions are exact.**
- A table's row *i* is Excel row *i + 1*, and a cell's column *j* is Excel column *j + 1*, always counted from row 1 and column A.
- Blank rows keep their place.
- Cells the file has but outside its declared range are still read (noted).

**Blank versus absent:**
- A cell **present but empty** in the file (e.g. a formatted empty cell) is kept with raw *empty* and type `empty`.
- A cell **not in the file** is absent from the table.

**Formulas are never calculated.**
- The cached result stored in the file is kept with the formula.
- If the file has no cached result, the cell is flagged and gets **no value**.
- The evidence verifier then insists such a value is recorded as *missing*, never blank or zero.
- Any value that comes from a formula is flagged during verification as "cached formula result, not recalculated".

**Merged cells**
- Each worksheet's merged ranges are recorded.
- A value hidden under a merged range is kept, with a warning.
- Overlapping merged ranges are reported as unusual.

**Problems inside a workbook** are reported in the result; nothing is skipped silently:
- a worksheet that fails (the others are still read)
- a cell that fails
- formulas without results, Excel errors
- hidden content
- an empty workbook

## 3. CSV files

CSV is read by the converter's own reader, **not** by the spreadsheet library. That library would turn text such as `1,250.00` or `01/02/2000` into numbers or dates. Every CSV field is kept as the **exact text** in the file.

| Supported | Detail |
|---|---|
| Encodings | UTF-8 with or without a BOM (the BOM is not kept in the first cell); UTF-16 with a BOM (Excel "Unicode text"); others such as Windows-1252 **only when chosen** |
| Delimiters | comma, semicolon, tab, `\|`, detected automatically or chosen |
| Quoting | quoted fields; delimiters and line breaks inside quotes; `""` for a quote inside a quoted field |
| Empty fields | kept as present-but-empty cells (`""`) |
| Short rows | missing fields are absent; a warning lists the row |
| Blank lines | kept as empty rows in place |
| Line endings | `\r\n`, `\n`, `\r` |

CSV references carry the row number (as a spreadsheet would show it) and the physical line the row starts on. These differ when a quoted description spans several lines.

**Refused rather than guessed:**
- text that isn't valid UTF-8, or UTF-16 without a BOM (`CSV_ENCODING_UNDETERMINED`)
- two delimiters fitting equally well (`CSV_DELIMITER_AMBIGUOUS`)
- no delimiter found (`CSV_DELIMITER_UNDETERMINED`)
- a quote that is never closed (`CSV_UNTERMINATED_QUOTE`)

In each case the user can choose the encoding or the delimiter and try again.

## 4. The result

```
document   file name, size, SHA-256 fingerprint, format; document type "unknown"
tables     one per worksheet (all of them, in order) or one for the CSV
sheets     per worksheet: name, position, visibility, ranges, merges, hidden rows/columns, counts, status
csv        encoding, BOM, delimiter (detected or chosen), line endings, field count
issues     every warning / error / note, with worksheet and cell address
```

The document type is set to "unknown" because deciding whether a file is a BQ, a working file or a claim is a later, reviewable step. The result is frozen and cannot be edited afterwards.
