# Value Parsing (Stage 2D)

This guide explains, in plain English, how the converter reads one cell. The code is in `src/core/parsing/`.

The parser reads **one cell at a time** and produces the evidence record described in `DATA_MODELS.md`.
- **No calculations:** it never sees other cells, so it cannot calculate missing figures (qty × rate, amount ÷ qty).
- **Original kept:** the cell's value is always kept exactly as `raw`.
- **Independent:** it uses neither React nor the Cost Library's own parsing functions.

## Column kinds

| Kind | Used for | Accepts |
|---|---|---|
| `quantity` | Qty columns | plain numbers |
| `money` | Rate and Amount columns | plain numbers, optionally with `RM` or `MYR` |
| `percent` | Profit %, % complete | numbers with or without `%` |

## Numbers that are accepted

The format follows the Malaysian convention: **comma = thousands separator, dot = decimal point**.

| Written | Read as |
|---|---|
| `1,250.00`, `1250`, `RM 1,250.00`, `RM1,250.00`, `MYR 1,250.00`, `RM. 1,250.00` | 1250 |
| `(50.00)`, `-50.00`, `−50.00` (Unicode minus), `RM (50.00)`, `(RM 50.00)`, `RM -50.00`, `-RM 50.00` | −50 |
| `12.375` | 12.375 (decimal quantities are fine) |
| `0`, `0.00`, `RM 0.00`, `(0.00)`, `-0` | **zero**, a real value |
| A number stored by Excel | that number exactly; no rounding to the decimals shown |

Extra spaces, non-breaking spaces and tabs are ignored. A leading `+`, leading zeros (`007`) and a missing leading digit (`.5`) are accepted, with a note.

## Empty cells

| Cell | State | Value |
|---|---|---|
| empty, spaces only | **blank** | none |
| not present in the extracted data | **missing** | none |

Neither becomes 0.

## Markers (never 0, never 1)

| Written | Marker |
|---|---|
| `Incl.`, `Included`, `Inc` | INCLUDED |
| `Excl.`, `Excluded` | EXCLUDED |
| `Rate Only`, `R.O.`, `R/O` | RATE_ONLY |
| `P.C. Sum`, `PC Sum`, `Prime Cost Sum`, `P.C.` | PRIME_COST_SUM |
| `Provisional Sum`, `Prov. Sum`, `Prov Sum`, `P.S.` | PROVISIONAL_SUM |
| `L.S.`, `LS`, `Lump Sum` | LUMP_SUM. **Not** a quantity of 1. *(This applies to Qty / Rate / Amount columns. In the Unit column, `L.S.` stays the unit text "L.S.", meaning lump sum.)* |
| `N/A`, `N.A.`, `NA` | NOT_APPLICABLE |
| `Nil` | NIL. **Not** zero |
| `By others` | BY_OTHERS |
| `-`, `–`, `—`, `--`, `RM -` | NIL_DASH. **Not** zero |

A marker must fill the whole cell. Text such as "Included in item 5" is flagged as unparseable rather than guessed at.

## Percentages

| Written | Percentage column | Qty / Rate / Amount column |
|---|---|---|
| `5%`, `5 %` | 5 | **flagged**. Whether it is a percentage item depends on the row, so the value is held back for review |
| Excel percentage cell (stored 0.05, shown `5%`) | 5 | **flagged** |
| `5` | 5 | (a normal number) |
| `0.05`, or a stored 0.05 not shown as % | **flagged**: could be 0.05 % or 5 % | (a normal number) |

## Flagged instead of guessed

These values get the state **unparseable**: no value enters the BQ. The possible readings are listed for a person to choose from.

| Example | Why | Possible reading offered |
|---|---|---|
| `1,25`, `1.250,00` | Comma used as a decimal point (European style) | 1.25 / 1250 |
| `12,50,000` | Commas not in groups of three (Indian style) | 1250000 |
| `1 250.00` | Spaces may separate two numbers (common after OCR) | 1250 |
| `50-` | Minus sign after the number | −50 |
| `(-50)`, `-(50)` | Both a minus sign and brackets | −50 |
| `1.2E+05` | Scientific notation; the spreadsheet may be showing a rounded figure | 120000 |
| `10 m2` | A unit inside a figure column | 10 |
| `m2`, `nr` in a Qty column | A unit, not a figure | — |
| `RM 10` in a Qty or % column | Money in a non-money column | 10 |
| `$`, `USD`, `S$`, `SGD` amounts | Not Ringgit | — |
| `approx. 10`, `abc`, `1.250.000` | Not a number | — |
| More than 15 significant digits | Cannot be held exactly | — |
| `TRUE` / `FALSE` | Not a figure | — |

## Text and units

- **Descriptions and item numbers** are kept exactly as written: spaces, capitals and line breaks included.
- **Stored numbers:** when Excel stores an item number as a number (1.1 shown as `1.10`), the shown text is used so `1.10` isn't changed to `1.1`.
- **Units** are kept exactly as written; `m2` is **not** converted to `m²`. The parser notes whether the unit is a recognised one.
- **A number in the Unit column** (e.g. `10`) is flagged, because it is probably a quantity in the wrong column.
- **A blank unit** stays blank. It does not become "item".
- **`L.S.`, `LS` or `Lump Sum` in the Unit column** is kept exactly as written and tagged with the meaning "lump sum". The quantity is not affected: no quantity of 1 is implied or filled in.
