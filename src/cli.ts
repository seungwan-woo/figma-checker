import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import * as E from 'fp-ts/lib/Either.js';
import * as TE from 'fp-ts/lib/TaskEither.js';
import { pipe } from 'fp-ts/lib/function.js';
import { decodeSnapshot, fetchSnapshot, figmaNodeLink, parseFigmaTarget } from './figma.js';
import type { FigmaTarget } from './figma.js';
import { instanceSourceRuleId } from './instance-source.js';
import { defaultNamingPattern, evaluateSnapshot, namingRuleId } from './lint.js';
import { asRecord } from './types.js';
import type { CheckError } from './types.js';

const invalidConfig = {
  code: 'INVALID_CONFIG', message: 'Check the source alias, URL, and rules in the config.',
};

type Config = { source: string; target: FigmaTarget; namingPattern: RegExp | null; instanceSourceEnabled: boolean };

function loadJson(path: string, error: CheckError): TE.TaskEither<CheckError, unknown> {
  return TE.tryCatch(async (): Promise<unknown> => JSON.parse(await readFile(path, 'utf8')), () => error);
}

function readConfig(raw: unknown): E.Either<CheckError, Config> {
  const config = asRecord(raw);
  if (!config || typeof config.source !== 'string' || !/^[a-zA-Z0-9._-]{1,64}$/.test(config.source)
      || (config.url !== undefined && typeof config.url !== 'string')) {
    return E.left(invalidConfig);
  }
  const rules = asRecord(config.rules);
  if (config.rules !== undefined && (!rules || Object.keys(rules).some((id) => id !== namingRuleId && id !== instanceSourceRuleId))) {
    return E.left(invalidConfig);
  }
  const value = rules?.[namingRuleId];
  const naming = asRecord(value);
  if (value !== undefined && !naming) return E.left(invalidConfig);
  const { enabled = true, pattern = defaultNamingPattern } = naming ?? {};
  if (typeof enabled !== 'boolean' || typeof pattern !== 'string' || !pattern || pattern.length > 256) {
    return E.left(invalidConfig);
  }
  const configuredSourceRule = rules?.[instanceSourceRuleId];
  const sourceRule = asRecord(configuredSourceRule);
  if (configuredSourceRule !== undefined && !sourceRule) return E.left(invalidConfig);
  const { enabled: instanceSourceEnabled = true } = sourceRule ?? {};
  if (typeof instanceSourceEnabled !== 'boolean') return E.left(invalidConfig);

  const source = config.source;
  const url = process.env.FIGMA_URL?.trim() || config.url?.trim();
  if (!url) return E.left({ code: 'MISSING_FIGMA_URL', message: 'Set FIGMA_URL or configure a Figma node URL.' });
  return pipe(
    parseFigmaTarget(url),
    E.flatMap((target) => E.tryCatch(
      () => ({ source, target, namingPattern: enabled ? new RegExp(pattern) : null, instanceSourceEnabled }),
      () => invalidConfig,
    )),
  );
}

function configFingerprint({ source, target, namingPattern }: Config): string {
  return createHash('sha256')
    .update(JSON.stringify([source, target.fileKey, target.nodeId, namingPattern?.source ?? null]))
    .digest('hex');
}

function scan(config: Config, fixture: string | undefined, transport: typeof fetch) {
  const { target, namingPattern, instanceSourceEnabled } = config;
  const token = process.env.FIGMA_TOKEN?.trim();
  const snapshot = fixture !== undefined
    ? pipe(
      loadJson(fixture, { code: 'INVALID_FIXTURE', message: 'Could not read the fixture JSON.' }),
      TE.flatMapEither((value) => decodeSnapshot(value, target.nodeId)),
    )
    : token
      ? fetchSnapshot(target, token, transport)
      : TE.left<CheckError, never>({ code: 'MISSING_FIGMA_TOKEN', message: 'Set FIGMA_TOKEN for a live scan.' });
  return pipe(snapshot, TE.map((value) => evaluateSnapshot(value, target, namingPattern, {
    enabled: instanceSourceEnabled, includeLinks: fixture === undefined,
  })));
}

async function writeReport(output: string, report: object) {
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  const temporary = `${output}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
}

const usage = 'Usage: npm run check:figma -- [--config FILE] [--fixture FILE] [--output FILE]';

async function main() {
  let args: { config?: string; fixture?: string; output?: string; help?: boolean };
  try {
    args = parseArgs({ options: {
      config: { type: 'string' }, fixture: { type: 'string' }, output: { type: 'string' }, help: { type: 'boolean' },
    } }).values;
  } catch {
    console.error(usage);
    return 1;
  }
  if (args.help) {
    console.log(usage);
    return 0;
  }

  const started = performance.now();
  const config = await pipe(
    loadJson(args.config ?? 'figma-checker.config.json', invalidConfig),
    TE.flatMapEither(readConfig),
  )();
  const configuredAt = performance.now();
  let nodesApiRequests = 0;
  const transport: typeof fetch = (...args) => {
    nodesApiRequests++;
    return fetch(...args);
  };
  const result = await pipe(TE.fromEither(config), TE.flatMap((value) => scan(value, args.fixture, transport)))();
  const diagnostics = {
    nodesApiRequests,
    cache: 'disabled',
    milliseconds: { config: Math.round(configuredAt - started), scan: Math.round(performance.now() - configuredAt) },
    coverage: { configured: E.isRight(config) ? 1 : 0, evaluated: E.isRight(result) ? 1 : 0 },
  };
  const run = {
    schemaVersion: 1,
    runId: randomUUID(),
    createdAt: new Date().toISOString(),
    source: E.isRight(config) ? config.right.source : null,
    configHash: E.isRight(config) ? configFingerprint(config.right) : null,
    targetUrl: E.isRight(config) ? figmaNodeLink(config.right.target, config.right.target.nodeId) : null,
    mode: args.fixture !== undefined ? 'fixture' : 'live',
    diagnostics,
  };
  const report = E.isLeft(result)
    ? { ...run, status: 'error', error: result.left }
    : { ...run, status: 'complete', ...result.right };
  try {
    await writeReport(args.output ?? 'reports/report.json', report);
  } catch {
    console.error('REPORT_WRITE_FAILED: Could not write the JSON report.');
    return 1;
  }

  console.log(JSON.stringify({
    status: report.status,
    ...diagnostics,
    httpStatus: E.isLeft(result) ? result.left.httpStatus : undefined,
    retryAfterSeconds: E.isLeft(result) ? result.left.retryAfterSeconds : undefined,
  }));
  if (E.isLeft(result)) {
    console.error(`${result.left.code}: ${result.left.message}`);
    return 1;
  }
  const [adoption] = result.right.metrics;
  console.log(`Auto Layout: ${adoption?.enabled ?? 0}/${adoption?.eligible ?? 0}; advisory findings: ${result.right.findings.length}.`);
  return 0;
}

process.exitCode = await main();
