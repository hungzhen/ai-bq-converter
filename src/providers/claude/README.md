# ClaudeProvider: design notes only

**Status: not implemented.** This folder holds no code and no API key. Phase 2 uses conventional rule-based processing only (D-002), and the provider registry refuses AI providers (`PHASE_2_POLICY`).

## When it is built (a later phase, only with the owner's approval)

- **Where it runs.** On a **server function** (e.g. a Supabase Edge Function in the converter's own project) that holds the Anthropic API key. The browser never holds the key.
- **What it is not.** Claude Pro and Claude Code are development tools. They are **never** used as a runtime service for deployed users.
- **Same interface.** It implements the same `InterpretationProvider` interface as the rule-based provider (`../types.ts`):
  - `kind: 'ai'`
  - `displayLabel: AI_LABEL`
  - `requiresNetwork: true`
- **What it may interpret.** Construction terminology, descriptions, bill hierarchy, column meanings, document relationships, and claim-to-BQ matches.
- **What it returns.** **Decisions that cite cells** (`CellRef`), optionally with the quoted cell text.
- **What it may never supply.** Quantities, rates, amounts, units or descriptions. The decision types have no place for them.
- **Checks on every answer.** Every answer goes through the **evidence verifier** (`src/core/evidence/verifier.ts`). Answers with no citations, cells that don't exist, quotes that don't match, cells from the wrong document, extra fields (such as an invented figure) or a claimed approval are rejected.
- **Approval.** Every answer stays a **proposal** until a person approves it (`src/core/evidence/proposals.ts`).
- **Size of requests.** Requests send only the excerpts needed. An organisation-level consent setting controls whether documents may be sent at all.
- **Hybrid option.** A hybrid provider may run the rules first and ask Claude only about decisions with low confidence.
