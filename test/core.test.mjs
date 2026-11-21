import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeSnapshot, fetchSnapshot, parseFigmaTarget } from '../dist/figma.js';
import { evaluateSnapshot } from '../dist/lint.js';

const url = 'https://www.figma.com/design/sample123/Demo?node-id=4-2&t=other';
const fixture = (document) => ({ version: 'test-1', nodes: { '4:2': { document } } });
const node = (id, type, fields = {}) => ({ id, type, name: 'Named layer', ...fields });

test('the live client requests exactly the selected node and does not follow redirects', async () => {
  const { right: target } = parseFigmaTarget(url);
  const requests = [];
  const result = await fetchSnapshot(target, 'test-token', async (endpoint, options) => {
    requests.push([endpoint.href, new Headers(options.headers).get('X-Figma-Token'), options.redirect]);
    return Response.json(fixture(node('4:2', 'FRAME')));
  })();
  assert.equal(result._tag, 'Right');
  assert.equal(result.right.root.id, '4:2');
  assert.deepEqual(requests, [['https://api.figma.com/v1/files/sample123/nodes?ids=4%3A2', 'test-token', 'error']]);
});

test('a 429 reports retry timing without retrying or copying the server body', async () => {
  const { right: target } = parseFigmaTarget(url);
  let requests = 0;
  const result = await fetchSnapshot(target, 'test-token', async () => {
    requests++;
    return new Response('private file details', { status: 429, headers: { 'Retry-After': '60' } });
  })();
  assert.equal(requests, 1);
  assert.equal(result._tag, 'Left');
  assert.equal(result.left.code, 'FIGMA_RATE_LIMIT');
  assert.equal(result.left.retryAfterSeconds, 60);
  assert.doesNotMatch(JSON.stringify(result), /private file details|test-token/);
});

test('a missing layout mode gives 0% when an eligible container exists and null when none exist', () => {
  const { right: target } = parseFigmaTarget(url);
  const frame = node('4:2', 'FRAME');
  const report = (root) => evaluateSnapshot(decodeSnapshot(fixture(root), target.nodeId).right, target, null);
  assert.equal(report(frame).metrics[0].percentage, null);
  const eligible = report({ ...frame, children: [node('4:3', 'TEXT')] });
  assert.equal(eligible.metrics[0].eligible, 1);
  assert.equal(eligible.metrics[0].percentage, 0);
});

test('naming checks nested and hidden layers without filtering by node type', () => {
  const { right: target } = parseFigmaTarget(url);
  const page = node('4:2', 'CANVAS', { children: [
    node('4:3', 'SECTION', { children: [node('4:4', 'FRAME', { name: 'Frame 4' })] }),
    node('4:5', 'FRAME', { children: [
      node('4:6', 'RECTANGLE', { name: 'Frame 6', visible: false }),
      node('4:7', 'TEXT', { name: 'Frame 7 copy' }),
    ] }),
  ] });
  const { right: snapshot } = decodeSnapshot(fixture(page), target.nodeId);
  const result = evaluateSnapshot(snapshot, target, /^Frame(?: [0-9]+)?$/);
  assert.deepEqual(result.findings.map(({ nodeId, pageId, url }) => ({ nodeId, pageId, url })), [{
    nodeId: '4:4', pageId: '4:2', url: 'https://www.figma.com/design/sample123/Demo?node-id=4-4',
  }, {
    nodeId: '4:6', pageId: '4:2', url: 'https://www.figma.com/design/sample123/Demo?node-id=4-6',
  }]);
});

test('file-only and non-Figma URLs are rejected before requests', () => {
  assert.equal(parseFigmaTarget('https://www.figma.com/design/sample123/Demo').left.code, 'NODE_ID_REQUIRED');
  assert.equal(parseFigmaTarget('https://www.figma.com.example/design/sample123/Demo?node-id=4-2').left.code, 'INVALID_FIGMA_URL');
});

test('a Figma branch link selects the branch key and keeps its branch deep link', async () => {
  const branchUrl = 'https://www.figma.com/design/main123/branch/branch456/Demo?node-id=4-2';
  const { right: target } = parseFigmaTarget(branchUrl);
  const result = await fetchSnapshot(target, 'test-token', async (endpoint) => {
    assert.equal(endpoint.pathname, '/v1/files/branch456/nodes');
    return Response.json(fixture(node('4:2', 'FRAME', { name: 'Frame 2' })));
  })();
  assert.equal(result._tag, 'Right');
  const report = evaluateSnapshot(result.right, target, /^Frame \d+$/);
  assert.equal(report.findings[0].url, branchUrl);
});

test('naming checks a directly selected instance descendant while the adoption metric excludes it', () => {
  const id = 'I4:7;4:2';
  const { right: target } = parseFigmaTarget('https://www.figma.com/design/sample123/Demo?node-id=I4-7%3B4-2');
  const root = node(id, 'FRAME', {
    name: 'Frame 2', layoutMode: 'HORIZONTAL', children: [node('I4:7;4:3', 'TEXT')],
  });
  const { right: snapshot } = decodeSnapshot({ version: 'test-1', nodes: { [id]: { document: root } } }, id);
  const report = evaluateSnapshot(snapshot, target, /^Frame \d+$/);
  assert.equal(report.metrics[0].eligible, 0);
  assert.deepEqual(report.findings.map(({ nodeId }) => nodeId), [id]);
});
