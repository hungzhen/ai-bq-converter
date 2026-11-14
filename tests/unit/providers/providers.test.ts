/**
 * Stage 2E — provider interface, registry and policy. SYNTHETIC — NOT REAL COST DATA.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PHASE_2_POLICY, ProviderPolicyError, createProviderRegistry } from '../../../src/providers/registry.ts';
import { AI_LABEL, type InterpretationProvider, RULE_BASED_LABEL } from '../../../src/providers/types.ts';
import { describeProviderContract } from '../../contract/providerContract.ts';
import { SYNTHETIC_RULE_INFO, syntheticRuleProvider } from '../../helpers/providers.ts';
import { BQ_XLSX, syntheticProject } from '../../helpers/synthetic/models.ts';
import { ALL_TABLES } from '../../helpers/synthetic/tables.ts';

const withInfo = (info: Partial<InterpretationProvider['info']>): InterpretationProvider => ({
  ...syntheticRuleProvider(),
  info: { ...SYNTHETIC_RULE_INFO, ...info },
});

describe('provider registry (Phase 2 policy)', () => {
  it('accepts a conventional rule-based provider', () => {
    const registry = createProviderRegistry();
    registry.register(syntheticRuleProvider());
    expect(registry.list().map((p) => p.info.id)).toEqual(['synthetic-test-rules']);
    expect(registry.get('synthetic-test-rules')?.info.displayLabel).toBe(RULE_BASED_LABEL);
  });

  it('refuses any AI provider', () => {
    expect(() => createProviderRegistry().register(withInfo({ id: 'claude', kind: 'ai', displayLabel: AI_LABEL, requiresNetwork: true }))).toThrow(ProviderPolicyError);
    expect(() => createProviderRegistry().register(withInfo({ id: 'offline-ai', kind: 'ai', displayLabel: AI_LABEL }))).toThrow(/not enabled/);
  });

  it('refuses a provider that needs the network', () => {
    expect(() => createProviderRegistry().register(withInfo({ requiresNetwork: true }))).toThrow(/network/);
  });

  it('refuses a label that does not match the kind (rule-based must never look like AI, and vice versa)', () => {
    expect(() => createProviderRegistry().register(withInfo({ displayLabel: 'Smart AI reading' }))).toThrow(ProviderPolicyError);
  });

  it('refuses duplicates and unknown capabilities', () => {
    const registry = createProviderRegistry();
    registry.register(syntheticRuleProvider());
    expect(() => registry.register(syntheticRuleProvider())).toThrow(/already registered/);
    expect(() => createProviderRegistry().register(withInfo({ capabilities: ['readMinds' as never] }))).toThrow(/unknown capability/);
  });

  it('the Phase 2 policy allows neither AI nor network, and cannot be changed', () => {
    expect(PHASE_2_POLICY).toEqual({ allowAiProviders: false, allowNetwork: false });
    expect(Object.isFrozen(PHASE_2_POLICY)).toBe(true);
  });
});

describe('no external AI service, no network, no API key', () => {
  const srcDir = resolve(import.meta.dirname, '../../../src');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name)) files.push(path);
    }
  };
  walk(srcDir);

  it('no application file calls the network', () => {
    for (const file of files) {
      const code = readFileSync(file, 'utf8');
      expect(code, file).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket\s*\(|navigator\.sendBeacon/);
    }
  });

  it('no application file imports an AI SDK or reads an API key', () => {
    for (const file of files) {
      const code = readFileSync(file, 'utf8');
      expect(code, file).not.toMatch(/from\s+['"](@anthropic-ai|anthropic|openai|@google\/generative-ai)/);
      expect(code, file).not.toMatch(/API_KEY|apiKey\s*[:=]/i);
    }
  });

  it('the Claude provider folder holds design notes only, no code', () => {
    const claudeDir = join(srcDir, 'providers/claude');
    expect(readdirSync(claudeDir)).toEqual(['README.md']);
  });
});

describeProviderContract('synthetic test rules', syntheticRuleProvider, {
  project: syntheticProject(),
  document: BQ_XLSX,
  tables: ALL_TABLES,
});
