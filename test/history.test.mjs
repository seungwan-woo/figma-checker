import assert from 'node:assert/strict';
import test from 'node:test';
import { addAttempt, readHistory, renderHistory, selectReport } from '../dist/history.js';
import { preparePublicReport } from '../dist/pages.js';

const targetUrl = 'https://www.figma.com/design/test123/Demo?node-id=13-32';
const successful = (date, enabled = 3) => ({
  schemaVersion: 1, status: 'complete', mode: 'live', createdAt: `2026-11-${date}T02:13:01.000Z`,
  targetUrl: `${targetUrl}&t=ignored`,
  snapshot: { figmaVersion: `rev-${date}` },
  metrics: [{ id: 'auto-layout-adoption', enabled, eligible: 4, percentage: enabled * 25 }],
  findings: [{ ruleId: 'default-frame-name', nodeName: 'Frame 12', nodeId: '13:32', url: targetUrl }],
  secretMetadata: 'must-not-be-public',
});
const sample = preparePublicReport({ ...successful('21'), mode: 'fixture' });

test('two live runs survive serialization and the Pages table shows both points', () => {
  const first = addAttempt([], '100', successful('19', 2));
  const latest = addAttempt(first, '101', successful('20'));
  const restored = readHistory(JSON.parse(JSON.stringify(latest)));
  assert.equal(restored.length, 2);
  assert.equal(selectReport(restored, sample).metrics[0].percentage, 75);
  const html = renderHistory(restored);
  assert.match(html, /50%/);
  assert.match(html, /75%/);
  assert.match(html, /rev-20/);
  assert.match(html, /https:\/\/www\.figma\.com\/design\/test123/);
  assert.doesNotMatch(JSON.stringify(restored), /must-not-be-public|t=ignored/);
});

test('a failed rerun preserves an earlier successful attempt and writing the same attempt is idempotent', () => {
  const initial = addAttempt([], '100-1', successful('19', 2));
  const failed = addAttempt(initial, '100-2', {
    ...successful('20'), status: 'error', error: { code: 'FIGMA_RATE_LIMIT', httpStatus: 429 },
  });
  assert.equal(selectReport(failed, sample).metrics[0].percentage, 50);
  assert.match(renderHistory(failed), /FIGMA_RATE_LIMIT/);
  assert.doesNotMatch(renderHistory(failed), /75%/);
  const retried = addAttempt(failed, '100-2', successful('21'));
  assert.equal(retried.length, 2);
  assert.doesNotMatch(renderHistory(retried), /FIGMA_RATE_LIMIT/);
});

test('fixture runs and Figma targets have distinct history groups', () => {
  const first = addAttempt([], '100', successful('19'));
  const second = addAttempt(first, '101', { ...successful('20'), targetUrl: targetUrl.replace('13-32', '13-44') });
  const third = addAttempt(second, '102', { ...successful('21'), mode: 'fixture' });
  assert.equal(selectReport(third, sample).mode, 'live');
  assert.equal(new Set(third.map(({ report }) => report.scope)).size, 3);
});

test('public report strips non-Figma advisory links', () => {
  const [entry] = addAttempt([], '100', {
    ...successful('19'), findings: [{ ...successful('19').findings[0], url: 'https://example.org/private' }],
  });
  assert.doesNotMatch(JSON.stringify(entry), /example.org/);
});

test('history separates changed measurement definitions and shows when the naming rule is off', () => {
  const first = addAttempt([], '100', { ...successful('19'), configHash: 'a'.repeat(64) });
  const changed = successful('20');
  changed.metrics[0].version = 2;
  changed.findings = [];
  const history = addAttempt(first, '101', {
    ...changed,
    configHash: 'b'.repeat(64),
    rules: [{ id: 'default-frame-name', version: 1, enabled: false, evaluated: 0 }],
  });
  const html = renderHistory(readHistory(JSON.parse(JSON.stringify(history))));
  assert.match(html, /규칙 꺼짐/);
  assert.match(html, /측정 기준 v1/);
  assert.match(html, /측정 기준 v2/);
});

const byteLimit = 32 * 1024 * 1024;
const historyBytes = (entries) => Buffer.byteLength(`[\n${entries.map((entry) => JSON.stringify(entry)).join(',\n')}\n]\n`);

test('the retention limit accepts exactly 32 MiB of serialized UTF-8 and rejects one byte more', () => {
  const raw = { ...successful('20'), snapshot: { figmaVersion: '' } };
  const baseBytes = historyBytes([{ id: '100', report: preparePublicReport(raw, true) }]);
  const padding = byteLimit - baseBytes;
  raw.snapshot.figmaVersion = '가'.repeat(Math.floor(padding / 3)) + 'x'.repeat(padding % 3);
  assert.equal(historyBytes(addAttempt([], '100', raw)), byteLimit);
  raw.snapshot.figmaVersion += 'x';
  assert.throws(() => addAttempt([], '100', raw), /exceeds the retained history window/);
});

test('an older incoming attempt keeps its full summary and longest fitting detail prefix', () => {
  const ruleId = 'instance-source-reference';
  const older = {
    ...successful('19'),
    rules: [{ id: ruleId, version: 1, enabled: true, resolved: 2, unresolved: 3, notChecked: 1 }],
    findings: [successful('19').findings[0], ...[1, 2, 3].map((id) => ({
      ruleId, nodeId: `14:${id}`, reason: 'missing_component_entry',
    }))],
  };
  const expectedOlder = preparePublicReport({ ...older, findings: older.findings.slice(0, 3) }, true);
  const newer = { ...successful('20'), snapshot: { figmaVersion: '' } };
  const expectedBytes = historyBytes([
    { id: '101', report: preparePublicReport(newer, true) }, { id: '100', report: expectedOlder },
  ]);
  newer.snapshot.figmaVersion = 'x'.repeat(byteLimit - expectedBytes);
  const initial = addAttempt([], '101', newer);
  const retained = addAttempt(initial, '100', older);
  assert.equal(retained.length, 2);
  assert.equal(retained[0], initial[0]);
  assert.equal(historyBytes(retained), byteLimit);
  assert.deepEqual(retained[1].report, expectedOlder);
  assert.deepEqual(retained[1].report.findings.filter((f) => f.ruleId === ruleId).map((f) => f.nodeId), ['14:1', '14:2']);
  assert.deepEqual(retained[1].report.rules[0], {
    id: ruleId, version: 1, enabled: true, evaluated: 5, resolved: 2, unresolved: 3, notChecked: 1, omittedDetails: 1,
  });
});
