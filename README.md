# AI BQ Converter

A web application that reads construction documents and converts them into the standard BQ format of the existing Cost Library (`FullBQItem`). The documents are:
- standard Bills of Quantities
- contractor working files
- progress claims

The input formats are Excel, CSV, digital PDF and scanned PDF.

**Current status:** Phase 2, Stage 2B. The project foundation, plus a read-only copy of the Cost Library's `costLibrary.ts` (the `FullBQItem` target format). No document processing yet.

The copy is in `src/vendor/cost-library/` (see its [README](src/vendor/cost-library/README.md)). To check whether the Cost Library's file has changed since it was copied (this only reads files and never updates the copy):

```bash
npm run check:cost-library -- /path/to/Cost-Library
```

**Processing:** conventional rule-based processing. No AI is used, and no API key is needed.

---

## Ground rules

- **Separate from the Cost Library.** This app never modifies the Cost Library's code, database or deployment.
- **No invented values.** The converter never invents quantities, rates, amounts, units or descriptions. Every value must trace back to a cell, page or position in the source document.
- **Claims are separate.** Progress claim data is kept apart from original BQ data.
- **People approve.** A person reviews and approves the results before anything is exported.

The full design is in [`docs/PHASE1_ARCHITECTURE.md`](docs/PHASE1_ARCHITECTURE.md), the current plan in [`docs/PHASE2_PLAN.md`](docs/PHASE2_PLAN.md), and approved decisions in [`docs/DECISIONS.md`](docs/DECISIONS.md).

---

## Running it on your computer

You need **Node.js 22** (from https://nodejs.org). Open a terminal in this folder, then run:

1. Install the packages (once, and again whenever `package.json` changes):

   ```bash
   npm install
   ```

2. Start the app, then open the address it prints (normally http://localhost:5173):

   ```bash
   npm run dev
   ```

3. Run the automated tests:

   ```bash
   npm test
   ```

4. Check the code for type errors:

   ```bash
   npm run lint
   ```

5. Build the production version (into the `dist/` folder):

   ```bash
   npm run build
   ```

---

## Main dependencies

| Package | Version | Purpose |
|---|---|---|
| React / React DOM | 19.3.1 | Screens |
| Vite | 8.3.8 | Development server and build |
| TypeScript | 7.0.2 | Type-checked JavaScript |
| Tailwind CSS | 4.3.5 | Styling |
| Vitest | 5.1.0 | Automated tests |
| **SheetJS (xlsx)** | **0.20.3** | Reading XLSX / XLS / CSV. Installed from the official SheetJS CDN: `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`. **Not** the outdated npm-registry 0.18.5. See `docs/DECISIONS.md` D-003 |

All versions are pinned exactly in `package.json`.

---

## Test documents

- **Synthetic files:** created by the test code, labelled *SYNTHETIC — NOT REAL COST DATA*.
- **Real documents** (preferably anonymised): put them in `tests/fixtures/private/`. That folder is excluded from git and never committed.
