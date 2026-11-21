import assert from 'node:assert/strict';
import test from 'node:test';
import { preparePublicReport, renderReport } from '../dist/pages.js';

const report = {
  schemaVersion: 1,
  status: 'complete',
  mode: 'fixture',
  createdAt: '2026-11-21T02:13:01.000Z',
  metrics: [{ id: 'auto-layout-adoption', enabled: 3, eligible: 4, percentage: 75 }],
  findings: [{ ruleId: 'default-frame-name', nodeName: 'Frame 12', nodeId: '13:32', url: 'private-placeholder' }],
  metadata: 'private-placeholder',
};

test('Pages renders the fixture counts and offers the JSON report', () => {
  const publicReport = preparePublicReport(report);
  const html = renderReport(publicReport);
  assert.match(html, /75%/);
  assert.match(html, /3\s*\/\s*4/);
  assert.match(html, /Frame 12/);
  assert.match(html, /href="\.\/report\.json"/);
  assert.doesNotMatch(JSON.stringify(publicReport), /private-placeholder/);
});

test('Pages refuses live reports and errors', () => {
  assert.throws(() => preparePublicReport({ ...report, mode: 'live' }), /fixture/);
  assert.throws(() => preparePublicReport({ ...report, status: 'error' }), /fixture/);
});

test('Pages escapes frame labels and shows unknown adoption separately from zero', () => {
  const publicReport = preparePublicReport({
    ...report,
    metrics: [{ id: 'auto-layout-adoption', enabled: 0, eligible: 0, percentage: null }],
    findings: [{ ...report.findings[0], nodeName: '<img src=x>' }],
  });
  const html = renderReport(publicReport);
  assert.match(html, /측정 대상 없음/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(html, /<img src=x>/);
});
