import { figmaNodeLink } from './figma.js';
import type { FigmaTarget, Layer, Snapshot } from './figma.js';

export const namingRuleId = 'default-frame-name';

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

function topLevelFrames(root: Layer): Layer[] {
  if (!root.visible || isInstance(root)) return [];
  if (root.type === 'FRAME') return [root];
  if (root.type !== 'CANVAS' && root.type !== 'SECTION') return [];
  const result: Layer[] = [];
  const pending = root.children.toReversed();
  for (let layer = pending.pop(); layer; layer = pending.pop()) {
    if (!layer.visible || isInstance(layer)) continue;
    if (layer.type === 'FRAME') result.push(layer);
    if (layer.type === 'SECTION') {
      for (const child of layer.children.toReversed()) pending.push(child);
    }
  }
  return result;
}

export function evaluateSnapshot(snapshot: Snapshot, target: FigmaTarget, namingPattern: RegExp | null) {
  const { root, figmaVersion } = snapshot;
  const pageId = root.type === 'CANVAS' ? root.id : null;
  const frames = namingPattern ? topLevelFrames(root) : [];
  const findings = frames
    .filter((frame) => namingPattern?.test(frame.name))
    .map((frame) => ({
      ruleId: namingRuleId, ruleVersion: 1, status: 'fail' as const, severity: 'advisory' as const,
      nodeId: frame.id, nodeName: frame.name, pageId, url: figmaNodeLink(target, frame.id),
      message: 'Rename this frame to describe the screen or section it represents.',
    }));
  return {
    snapshot: { figmaVersion, nodeId: root.id, nodeType: root.type, visibilityScope: pageId ? 'page' : 'subtree' },
    metrics: [adoption(root)],
    rules: [{
      id: namingRuleId, version: 1, enabled: namingPattern !== null,
      evaluated: frames.length, failed: findings.length,
    }],
    findings,
  };
}
