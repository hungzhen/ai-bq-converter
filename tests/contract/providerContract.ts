/**
 * SHARED PROVIDER CONTRACT — every InterpretationProvider must pass these tests
 * (the synthetic test provider now; the RuleBasedProvider in Stage 2G; any AI provider later).
 */
import { describe, expect, it } from 'vitest';
import type { ConverterProject, ExtractedTable, SourceDocument } from '../../src/core/models/index.ts';
import { verifyInterpretation } from '../../src/core/evidence/index.ts';
import {
  ALL_CAPABILITIES,
  AI_LABEL,
  type Interpretation,
  type InterpretationProvider,
  RULE_BASED_LABEL,
  providerStamp,
} from '../../src/providers/types.ts';

export interface ContractFixture {
  readonly project: ConverterProject;
  readonly document: SourceDocument;
  readonly tables: readonly ExtractedTable[];
}

const FIGURE_KEYS = ['quantity', 'qty', 'rate', 'amount', 'unit', 'description', 'total', 'value', 'price'];

function allKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
}

export function describeProviderContract(name: string, makeProvider: () => InterpretationProvider, fixture: ContractFixture): void {
  describe(`provider contract: ${name}`, () => {
    const provider = makeProvider();
    const ctx = { project: fixture.project, document: fixture.document, tables: fixture.tables };

    async function everyAnswer(): Promise<Interpretation[]> {
      const regions = await provider.detectTableRegions(ctx);
      const columns = await provider.mapColumns(ctx, regions.map((r) => r.value));
      const rows = await provider.classifyRows(ctx, columns.map((c) => c.value), regions.map((r) => r.value));
      return [
        ...(await provider.classifyDocument(ctx)),
        ...regions,
        ...columns,
        ...rows,
        ...(await provider.interpretHierarchy(ctx, rows.map((r) => r.value))),
        ...(await provider.suggestClassifications(ctx, rows.map((r) => r.value))),
        ...(await provider.relateDocuments({ project: fixture.project, tables: fixture.tables })),
        ...(await provider.matchClaimLines({ project: fixture.project, claimLines: [], bqRows: [], tables: fixture.tables })),
      ];
    }

    it('identifies itself with id, version, kind and the matching label', () => {
      expect(provider.info.id.trim()).not.toBe('');
      expect(provider.info.version.trim()).not.toBe('');
      expect(provider.info.displayLabel).toBe(provider.info.kind === 'ai' ? AI_LABEL : RULE_BASED_LABEL);
      expect(provider.info.capabilities.every((c) => ALL_CAPABILITIES.includes(c))).toBe(true);
    });

    it('a rule-based provider never needs the network', () => {
      if (provider.info.kind === 'rule-based') expect(provider.info.requiresNetwork).toBe(false);
    });

    it('returns only proposals, stamped with its own id and kind', async () => {
      const answers = await everyAnswer();
      expect(answers.length).toBeGreaterThan(0);
      for (const a of answers) {
        expect(a.status).toBe('proposed');
        expect(a.providerId).toBe(providerStamp(provider.info));
        expect(a.method).toBe(provider.info.kind);
      }
    });

    it('cites cells for every answer, and every answer passes the evidence verifier', async () => {
      for (const a of await everyAnswer()) {
        expect(a.evidence.length).toBeGreaterThan(0);
        const report = verifyInterpretation(a, { project: fixture.project, tables: fixture.tables, documentId: fixture.document.id, provider: provider.info });
        expect(report.findings.filter((f) => f.severity === 'blocking'), JSON.stringify(a)).toEqual([]);
      }
    });

    it('quotes the exact text of every cited cell', async () => {
      for (const a of await everyAnswer()) {
        if (a.evidence.some((e) => e.columnIndex !== undefined)) {
          expect(a.quotedText, `${a.decisionKind} cites cells without quoting them`).toBeDefined();
          expect(a.quotedText!.length).toBe(a.evidence.length);
        }
      }
    });

    it('never supplies a figure, unit or description', async () => {
      for (const a of await everyAnswer()) {
        const keys = allKeys([a.value, ...(a.alternatives ?? []).map((x) => x.value)]);
        for (const k of FIGURE_KEYS) expect(keys.has(k), `${a.decisionKind} contains "${k}"`).toBe(false);
      }
    });

    it('returns nothing from methods it does not claim to support', async () => {
      const answers = await everyAnswer();
      const byKind: Record<string, string> = {
        documentType: 'classifyDocument', tableRegion: 'detectTableRegions', columnRole: 'mapColumns', rowClass: 'classifyRows',
        hierarchy: 'interpretHierarchy', classificationSuggestion: 'suggestClassifications', relationship: 'relateDocuments', claimMatch: 'matchClaimLines',
      };
      for (const a of answers) expect(provider.info.capabilities).toContain(byKind[a.decisionKind]);
    });
  });
}
