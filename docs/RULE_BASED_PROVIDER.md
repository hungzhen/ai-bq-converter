# Rule-Based Provider (Stage 2G)

This is a plain-English guide to the first interpretation stage. The code is in `src/providers/rule-based/`, and every word and pattern it looks for is in `vocabulary.ts`.

The provider reads the extracted tables (Stage 2F) and **proposes** how the document is structured. It is labelled *"Conventional rule-based processing"*. There is no AI, no network and no API key.

Every answer:
- cites the exact cells it relied on, with their exact text
- explains itself
- gives a confidence between 0 and 1
- lists **alternative readings** when the evidence is ambiguous

Every answer must pass the evidence verifier (Stage 2E), and nothing becomes approved until a person approves it.

## What it proposes

| Proposal | How |
|---|---|
| **Document type** | Signal words in headings and labels across all worksheets. **Claim:** previous, this claim, cumulative / to date, % complete, certified, valuation. **Working file:** cost / net rate, selling rate, markup / profit, material, labour, plant, supplier, build-up. **BQ:** description, unit, qty, rate, amount, bill no., collection, summary. At least two distinct signals are needed (three for a plain BQ); otherwise **Unknown**. |
| **Table regions** | The heading row is the row with several heading words. A *group* heading row above it (Contract / Previous Claim / This Claim / Cumulative, or a merged heading) is included. Headings repeated further down are listed as **repeated header rows**. A sheet with no headings (e.g. a cover) is proposed as *not part of the BQ table*, at low confidence. |
| **Column meanings** | From the **heading text** (and group heading) **and the content below**. When they agree, the role is proposed. When they disagree (a *misleading heading*), the column is **Unknown** with both readings as alternatives. A numeric column with no recognisable heading is Unknown with quantity / rate / amount as alternatives. Several Qty columns: "Total Qty" is the quantity and the others are additional quantities; with no total, the first Qty column keeps "additional quantity" as an alternative. |
| **Row types** | **Every row** gets exactly one proposal, so no row is discarded: title, column header (first or repeated), bill / section / main heading, sub-heading, priced item, description-only item, continuation, note label, note / specification, Provisional Sum, Prime Cost Sum, percentage item, sub-total, total, carried / brought forward, collection, summary, page marker, blank, unknown. |
| **Hierarchy** | Bill > section > main heading > sub-heading > secondary sub-heading > item. A continuation line belongs to the item above it (it is **not joined**). Only headings present in the document are used. An item with no heading above it is **left unresolved**. |
| **Trade / Sub-trade** | Keywords in the item's own description, or else in the heading above it (trade only). Labels come from the Cost Library's 19 trade packages and their sub-trades. The description is never changed. |

## Conservative rules

- **Figures:** a number alone doesn't make a priced item. A priced item needs a description and either a unit with a figure or marker, or a figure next to a description (lower confidence).
- **Text:** text alone doesn't make a heading. Long text is a note; text starting in lower case right after an item may be its continuation; unclear short text is a low-confidence sub-heading with alternatives.
- **Percentages:** a percentage item needs unit `%` **and** wording such as "profit", "attendance" or "allow". Any other percentage figure leaves the row Unknown, with percentage item and priced item as alternatives.
- **Sums:** "PROVISIONAL SUMS" written as a heading with no figures is a heading. A Provisional Sum *item* needs item-like content.
- **No figures supplied:** nothing is calculated, no lump-sum quantity of 1 is assumed, and blank, dash and Nil stay as written. Negative figures are quoted as written. Duplicates, notes and unusual rows are kept. The provider never supplies a quantity, rate, amount, unit or description.

## Proposed, verified, approved, rejected

```
provider answer → evidence verifier → proposal
   failed_verification   blocking problem — can never be approved
   verified              passed the checks — awaiting a person (NOT approved)
   approved              a person approved it: who, when, note, which reading
   rejected              a person rejected it: who, when, note
```

- **Not approval:** high confidence is not approval, and passing verification is not approval.
- **Alternatives:** an answer with alternatives can only be approved by choosing a reading explicitly.
- **Warnings:** an answer with warnings needs an acknowledging note.
- **Bulk approval** is an explicit action by a named person. It only covers table regions, column meanings and row types that have no alternatives and no warnings. Everything else is skipped, with the reason, for individual review.
