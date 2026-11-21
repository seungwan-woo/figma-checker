import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeSnapshot, fetchSnapshot, parseFigmaTarget } from '../dist/figma.js';
import { evaluateSnapshot } from '../dist/lint.js';
import { addAttempt, readHistory, renderHistory } from '../dist/history.js';
import { namingStatus, preparePublicReport, renderReport } from '../dist/pages.js';

const ruleId = 'instance-source-reference';
const nameRuleId = 'default-frame-name';
const targetUrl = 'https://www.figma.com/design/main123/branch/branch456/Demo?node-id=4-2';
const { right: target } = parseFigmaTarget(targetUrl);
const node = (id, type, extra = {}) => ({ id, type, name: 'Private label', ...extra });
const instance = (id, componentId, extra) => node(id, 'INSTANCE', { componentId, ...extra });
const response = (children, components) => ({
  version: 'fixture-1', nodes: { '4:2': { document: node('4:2', 'FRAME', { children }), components } },
});
const inspect = (children, components) => {
  const { right: snapshot } = decodeSnapshot(response(children, components), '4:2');
  return evaluateSnapshot(snapshot, target, null);
};
const summary = (report) => report.rules.find((rule) => rule.id === ruleId);
const publicInput = (source) => ({
  schemaVersion: 1, status: 'complete', mode: 'live', createdAt: '2026-11-21T02:13:01.000Z',
  targetUrl, ...source,
});

test('identifies the component by componentId using the existing Nodes response and includes nested and hidden instances', async () => {
  const raw = response([
    instance('4:3', '8:1', { visible: false, children: [instance('I4:3;9:1', '8:2')] }),
    instance('4:4', '8:3'), instance('4:5', '8:4'), instance('4:6', ' \t'), instance('4:7', 9),
    node('I4:3;9:2', 'FRAME', { componentId: '8:3' }),
  ], {
    '8:1': { key: 'local-key', remote: false }, '8:2': { key: 'remote-key', remote: true },
    '8:4': { key: ' ' }, '4:4': { key: 'must-not-match-instance-id' },
  });
  let requests = 0;
  const result = await fetchSnapshot(target, 'synthetic-token', async () => {
    requests++;
    return Response.json(raw);
  })();
  assert.equal(requests, 1);
  const report = evaluateSnapshot(result.right, target, null);
  assert.deepEqual(summary(report), {
    id: ruleId, version: 1, enabled: true, evaluated: 6, resolved: 2, unresolved: 4, notChecked: 0, omittedDetails: 0,
  });
  assert.deepEqual(report.findings.map(({ reason }) => reason), [
    'missing_component_entry', 'invalid_component_entry', 'missing_component_id', 'missing_component_id',
  ]);
  assert.equal(report.findings[0].url, targetUrl.replace('4-2', '4-4'));
  assert.ok(report.findings.every(({ status, severity }) => status === 'skip' && severity === 'advisory'));
  assert.doesNotMatch(JSON.stringify(report), /Private label|local-key|remote-key/);
});

test('distinguishes absent or malformed source metadata from an available empty map', () => {
  const children = [instance('4:3', '8:1')];
  for (const components of [undefined, []]) {
    const report = inspect(children, components);
    assert.equal(summary(report).notChecked, 1);
    assert.equal(summary(report).evaluated, 0);
    assert.deepEqual(report.findings, []);
  }
  const empty = inspect(children, {});
  assert.equal(summary(empty).unresolved, 1);
  assert.equal(empty.findings[0].reason, 'missing_component_entry');
  const exact = inspect([instance('4:3', '8:1 ')], { '8:1': { key: 'source' } });
  assert.equal(exact.findings[0].reason, 'missing_component_entry');
  assert.equal(summary(inspect([], {})).unresolved, 0);
});

test('limits details to the first 100 instances while retaining full counts on Pages', () => {
  const children = Array.from({ length: 101 }, (_, index) => instance(`5:${index}`, '8:1'));
  const report = preparePublicReport(publicInput(inspect(children, {})), true);
  assert.equal(summary(report).unresolved, 101);
  assert.equal(summary(report).omittedDetails, 1);
  assert.equal(report.findings.length, 100);
  assert.equal(report.findings.at(-1).nodeId, '5:99');
  assert.match(renderReport(report), /101/);
});

test('publishes only allowed instance details and keeps naming separate after history reload', () => {
  const raw = publicInput(inspect([
    instance('4:3', '8:1'), instance('I4:3;9:1', '8:1'), instance('4:4', '8:1'), instance('4:5', '8:1'),
  ], {}));
  raw.findings[0].url = targetUrl.replace('/Demo?', '/Other?').replace('4-2', '4-3');
  raw.findings[0].nodeName = 'unsafe-instance-name';
  raw.findings[2].nodeId = 'unsafe-instance-id';
  raw.findings[3].reason = 'unsafe-instance-reason';
  raw.rules.reverse();
  raw.rules.find((rule) => rule.id === nameRuleId).enabled = true;
  raw.rules.find((rule) => rule.id === nameRuleId).evaluated = 1;
  raw.findings.push({ ruleId: nameRuleId, nodeId: '4:2', nodeName: 'Frame 2', url: targetUrl });

  const history = readHistory(JSON.parse(JSON.stringify(addAttempt([], '200', raw))));
  const report = history[0].report;
  assert.equal(namingStatus(report), '1건');
  assert.equal(summary(report).unresolved, 4);
  assert.equal(summary(report).omittedDetails, 2);
  assert.equal(report.findings.find(({ nodeId }) => nodeId === '4:3').url, targetUrl.replace('4-2', '4-3'));
  assert.equal(report.findings.find(({ nodeId }) => nodeId === 'I4:3;9:1').url, undefined);
  const html = renderReport(report);
  assert.match(html, /원본 확인 불가/);
  assert.match(html, /I4:3;9:1/);
  assert.doesNotMatch(html + JSON.stringify(history), /unsafe-instance|I4-3%3B9-1/);
  assert.match(renderHistory(history), /이름 규칙 v2/);
  assert.ok(preparePublicReport({ ...raw, mode: 'fixture' }).findings.every((finding) => !finding.url));
  assert.throws(() => preparePublicReport({ ...raw, targetUrl: 'https://example.org' }, true), /valid Figma target/);
});

test('a missing summary does not move another rule into the naming history series', () => {
  const raw = publicInput(inspect([instance('4:3', '8:1')], {}));
  raw.rules = raw.rules.filter(({ id }) => id === ruleId);
  const history = readHistory(JSON.parse(JSON.stringify(addAttempt([], '200', raw))));
  assert.equal(summary(history[0].report).unresolved, 1);
  assert.equal(namingStatus(history[0].report), '0건');
  assert.doesNotMatch(renderHistory(history), /이름 규칙 v1/);
  const old = preparePublicReport({ ...raw, rules: [], findings: [] }, true);
  assert.match(renderReport(old), /검사 결과 없음/);
});

test('a virtual instance flagged by both rules keeps its ID and publishes no finding link', () => {
  const id = 'I4:3;9:1';
  const { right: snapshot } = decodeSnapshot(response([
    instance(id, '8:1', { name: 'Instance 1' }),
  ], {}), '4:2');
  const result = evaluateSnapshot(snapshot, target, /^Instance \d+$/);
  assert.equal(result.findings.length, 2);
  assert.ok(result.findings.every((finding) => finding.nodeId === id && !finding.url));

  const oldLink = targetUrl.replace('4-2', 'I4-3%3B9-1');
  const raw = publicInput({ ...result, findings: result.findings.map((finding) => ({ ...finding, url: oldLink })) });
  const history = readHistory(JSON.parse(JSON.stringify(addAttempt([], '201', raw))));
  const report = history[0].report;
  assert.equal(report.findings.length, 2);
  assert.match(renderReport(report), /Instance 1/);
  assert.doesNotMatch(renderReport(report) + JSON.stringify(history), /I4-3%3B9-1/);
});
