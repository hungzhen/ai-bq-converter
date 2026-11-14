/**
 * PROVIDER REGISTRY — which interpretation providers the converter may use.
 *
 * The registry enforces the current policy. In Phase 2 (PHASE_2_POLICY):
 *   - AI providers are refused;
 *   - providers that need the network are refused;
 *   - a provider's display label must match its kind, so rule-based results are never
 *     presented as AI and AI results are never presented as conventional processing.
 */
import { AI_LABEL, ALL_CAPABILITIES, type InterpretationProvider, RULE_BASED_LABEL } from './types.ts';

export interface ProviderPolicy {
  readonly allowAiProviders: boolean;
  readonly allowNetwork: boolean;
}

/** Phase 2: conventional rule-based processing only, nothing over the network. */
export const PHASE_2_POLICY: ProviderPolicy = Object.freeze({ allowAiProviders: false, allowNetwork: false });

export class ProviderPolicyError extends Error {
  override name = 'ProviderPolicyError';
}

export interface ProviderRegistry {
  readonly policy: ProviderPolicy;
  register(provider: InterpretationProvider): void;
  get(id: string): InterpretationProvider | undefined;
  list(): readonly InterpretationProvider[];
}

export function createProviderRegistry(policy: ProviderPolicy = PHASE_2_POLICY): ProviderRegistry {
  const providers = new Map<string, InterpretationProvider>();

  return {
    policy,
    register(provider) {
      const { info } = provider;
      if (!info.id.trim() || !info.version.trim()) throw new ProviderPolicyError('A provider needs an id and a version.');
      if (providers.has(info.id)) throw new ProviderPolicyError(`Provider "${info.id}" is already registered.`);
      if (info.kind === 'ai' && !policy.allowAiProviders) {
        throw new ProviderPolicyError(`AI provider "${info.id}" is not allowed: AI interpretation is not enabled in this phase.`);
      }
      if (info.requiresNetwork && !policy.allowNetwork) {
        throw new ProviderPolicyError(`Provider "${info.id}" needs the network, which is not allowed in this phase.`);
      }
      const expectedLabel = info.kind === 'ai' ? AI_LABEL : RULE_BASED_LABEL;
      if (info.displayLabel !== expectedLabel) {
        throw new ProviderPolicyError(`Provider "${info.id}" must be labelled "${expectedLabel}".`);
      }
      if (info.capabilities.some((c) => !ALL_CAPABILITIES.includes(c))) {
        throw new ProviderPolicyError(`Provider "${info.id}" lists an unknown capability.`);
      }
      providers.set(info.id, provider);
    },
    get: (id) => providers.get(id),
    list: () => [...providers.values()],
  };
}
