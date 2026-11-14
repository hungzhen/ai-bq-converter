# AI BQ Converter — working notes for Claude Code

A separate React + Vite + TypeScript app that converts BQs, contractor working files and progress claims into the Cost Library's `FullBQItem` format.

Specification: `docs/PHASE1_ARCHITECTURE.md` (Revision 2). Plan: `docs/PHASE2_PLAN.md`. Decisions: `docs/DECISIONS.md`.

## Checks (run before every commit)

```
npm install
npm run lint
npm test
npm run build
```

To check whether the Cost Library's `costLibrary.ts` has changed since it was copied (read-only; never updates the copy):

```
npm run check:cost-library -- <path to a Cost Library checkout or file> [--ref <commit or branch>]
```

## Working rules

- **Build one stage at a time.** Commit and push it, show it to the owner, and wait for approval before the next stage.
- **Explain changes plainly.** The owner is not an experienced programmer: explain changes in plain English and give complete replacement files where practical.
- **Use synthetic test data only.** Label it "SYNTHETIC — NOT REAL COST DATA". Real documents go only in the git-ignored `tests/fixtures/private/`.

## Never

- Modify, push to or connect to the Cost Library repository, its Supabase database or its Cloudflare deployment.
- Connect to any production Supabase project.
- Add an AI SDK or require an API key before the owner approves the ClaudeProvider phase.
- Invent quantities, rates, amounts, units or descriptions; every value must trace to a source cell, page or position.
- Mix progress-claim data into BQ (`FullBQItem`) data.
- Replace SheetJS 0.20.3 from `cdn.sheetjs.com` with the npm-registry `xlsx` package.
- Edit `src/vendor/cost-library/costLibrary.ts` by hand (exact copy of the Cost Library file).
