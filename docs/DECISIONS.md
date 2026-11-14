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
