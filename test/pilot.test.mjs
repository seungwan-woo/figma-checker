import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const demoUrl = 'https://www.figma.com/design/synthetic/Example?node-id=13-32';

async function run(t, fixture, figmaUrl = demoUrl, config) {
  const directory = await mkdtemp(join(tmpdir(), 'figma-checker-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, 'report.json');
  const args = ['dist/cli.js', '--fixture', fixture, '--output', output];
  if (config) {
    const configPath = join(directory, 'config.json');
    await writeFile(configPath, JSON.stringify(config));
    args.push('--config', configPath);
  }
  const processResult = spawnSync(process.execPath, args, {
    env: { ...process.env, FIGMA_TOKEN: '', FIGMA_URL: figmaUrl },
    encoding: 'utf8',
  });
  return { ...processResult, output };
}

test('the manual fixture produces adoption counts and a link to the selected default-named frame', async (t) => {
  const result = await run(t, 'test/fixtures/pilot-nodes.json');
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(result.output, 'utf8'));
  assert.equal(report.status, 'complete');
  assert.equal(report.snapshot.figmaVersion, 'synthetic-1');
  assert.equal(report.snapshot.visibilityScope, 'subtree');
  assert.equal(report.diagnostics.nodesApiRequests, 0);
  assert.deepEqual(report.diagnostics.coverage, { configured: 1, evaluated: 1 });
  assert.deepEqual(report.metrics[0], {
    id: 'auto-layout-adoption', version: 1, enabled: 3, eligible: 4, percentage: 75,
  });
  assert.deepEqual(report.findings.map(({ nodeId, nodeName, status, url }) => ({
    nodeId, nodeName, status, url,
  })), [{
    nodeId: '13:32', nodeName: 'Frame 12', status: 'fail', url: demoUrl,
  }]);
});

test('a missing node produces a failed run rather than an empty successful report', async (t) => {
  const result = await run(t, 'test/fixtures/pilot-nodes.json', demoUrl.replace('13-32', '13-99'));
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(await readFile(result.output, 'utf8'));
  assert.equal(report.status, 'error');
  assert.equal(report.error.code, 'NODE_NOT_FOUND');
  assert.equal('metrics' in report, false);
});

test('the config can disable the naming rule without changing adoption', async (t) => {
  const result = await run(t, 'test/fixtures/pilot-nodes.json', demoUrl, {
    source: 'synthetic', rules: { 'default-frame-name': { enabled: false } },
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(result.output, 'utf8'));
  assert.equal(report.metrics[0].percentage, 75);
  assert.deepEqual(report.findings, []);
});

test('share parameters do not change the normalized config fingerprint', async (t) => {
  const first = await run(t, 'test/fixtures/pilot-nodes.json');
  const second = await run(t, 'test/fixtures/pilot-nodes.json', `${demoUrl}&t=share-only`);
  const original = JSON.parse(await readFile(first.output, 'utf8'));
  const alternate = JSON.parse(await readFile(second.output, 'utf8'));
  assert.match(original.configHash ?? '', /^[a-f0-9]{64}$/);
  assert.equal(alternate.configHash, original.configHash);
});

test('an explicit empty fixture path fails without falling back to live', async (t) => {
  const result = await run(t, '');
  assert.equal(result.status, 1);
  const report = JSON.parse(await readFile(result.output, 'utf8'));
  assert.equal(report.mode, 'fixture');
  assert.equal(report.error.code, 'INVALID_FIXTURE');
  assert.equal(report.diagnostics.nodesApiRequests, 0);
});
