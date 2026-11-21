import { figmaNodeLink, isVirtualFigmaNodeId, layersInTree } from './figma.js';
import type { FigmaTarget, Snapshot } from './figma.js';

export const instanceSourceRuleId = 'instance-source-reference';
export const instanceSourceVersion = 1;
export const instanceLabel = 'Instance';
export const instanceDetailLimit = 100;
export const instanceReasons = ['missing_component_id', 'missing_component_entry', 'invalid_component_entry'] as const;
export type InstanceReason = typeof instanceReasons[number];

export type InstanceSourceSummary = {
  id: typeof instanceSourceRuleId;
  version: number;
  enabled: boolean;
  evaluated: number;
  resolved: number;
  unresolved: number;
  notChecked: number;
  omittedDetails: number;
};

export type InstanceSourceOptions = { enabled: boolean; includeLinks: boolean };

export function evaluateInstanceSources(snapshot: Snapshot, target: FigmaTarget, options: InstanceSourceOptions) {
  const { componentReferences } = snapshot;
  const { enabled, includeLinks } = options;
  let resolved = 0;
  let unresolved = 0;
  let notChecked = 0;
  const findings = [];

  if (enabled) {
    for (const layer of layersInTree(snapshot.root)) {
      if (layer.type !== 'INSTANCE') continue;
      if (componentReferences === null) {
        notChecked++;
        continue;
      }
      const reference = layer.componentId === undefined ? undefined : componentReferences.get(layer.componentId);
      if (reference === 'valid') {
        resolved++;
        continue;
      }
      unresolved++;
      if (findings.length >= instanceDetailLimit) continue;
      const reason: InstanceReason = layer.componentId === undefined ? 'missing_component_id'
        : reference === 'invalid' ? 'invalid_component_entry' : 'missing_component_entry';
      findings.push({
        ruleId: instanceSourceRuleId, ruleVersion: instanceSourceVersion,
        status: 'skip' as const, severity: 'advisory' as const, reason,
        nodeId: layer.id, nodeName: instanceLabel,
        url: includeLinks && !isVirtualFigmaNodeId(layer.id) ? figmaNodeLink(target, layer.id) : undefined,
      });
    }
  }

  const summary: InstanceSourceSummary = {
    id: instanceSourceRuleId, version: instanceSourceVersion, enabled, evaluated: resolved + unresolved,
    resolved, unresolved, notChecked, omittedDetails: unresolved - findings.length,
  };
  return { summary, findings };
}
