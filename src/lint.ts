import { figmaNodeLink, isVirtualFigmaNodeId, layersInTree } from './figma.js';
import type { FigmaTarget, Layer, Snapshot } from './figma.js';
import { evaluateInstanceSources } from './instance-source.js';
import type { InstanceSourceOptions } from './instance-source.js';

export const namingRuleId = 'default-frame-name';
const namingRuleVersion = 2;
const defaultLayerNames = [
  'Page', 'Frame', 'Section', 'Group', 'Component', 'Component set', 'Component Set', 'Instance',
  'Rectangle', 'Ellipse', 'Line', 'Arrow', 'Polygon', 'Star', 'Vector', 'Text', 'Slice', 'Image',
  'Mask group', 'Union', 'Subtract', 'Intersect', 'Exclude',
];
export const defaultNamingPattern = `^(?:${defaultLayerNames.join('|')})(?: [0-9]+)?$`;

function isInstance(layer: Layer): boolean {
  return layer.type === 'INSTANCE' || layer.id.startsWith('I');
}

function adoption(root: Layer) {
  let eligible = 0;
  let enabled = 0;
  const pending = [root];
  for (let layer = pending.pop(); layer; layer = pending.pop()) {
    if (!layer.visible || isInstance(layer)) continue;
    if ((layer.type === 'FRAME' || layer.type === 'COMPONENT') && layer.children.some((child) => child.visible)) {
      eligible++;
      if (layer.layoutMode !== 'NONE') enabled++;
    }
    for (const child of layer.children) pending.push(child);
  }
  return {
    id: 'auto-layout-adoption', version: 1, enabled, eligible,
    percentage: eligible === 0 ? null : Math.round(enabled * 10_000 / eligible) / 100,
  };
}

export function evaluateSnapshot(
  snapshot: Snapshot, target: FigmaTarget, namingPattern: RegExp | null,
  instanceOptions: InstanceSourceOptions = { enabled: true, includeLinks: true },
) {
  const { root, figmaVersion } = snapshot;
  const pageId = root.type === 'CANVAS' ? root.id : null;
  let evaluated = 0;
  const findings = [];
  if (namingPattern) {
    const matcher = new RegExp(namingPattern);
    for (const layer of layersInTree(root)) {
      evaluated++;
      matcher.lastIndex = 0;
      if (!matcher.test(layer.name)) continue;
      findings.push({
        ruleId: namingRuleId, ruleVersion: namingRuleVersion, status: 'fail' as const, severity: 'advisory' as const,
        nodeId: layer.id, nodeName: layer.name, pageId,
        url: isVirtualFigmaNodeId(layer.id) ? undefined : figmaNodeLink(target, layer.id),
        message: 'Rename this layer to describe its role or content.',
      });
    }
  }
  const instanceSources = evaluateInstanceSources(snapshot, target, instanceOptions);
  return {
    snapshot: { figmaVersion, nodeId: root.id, nodeType: root.type, visibilityScope: pageId ? 'page' : 'subtree' },
    metrics: [adoption(root)],
    rules: [{
      id: namingRuleId, version: namingRuleVersion, enabled: namingPattern !== null,
      evaluated, failed: findings.length,
    }, instanceSources.summary],
    findings: [...findings, ...instanceSources.findings],
  };
}
