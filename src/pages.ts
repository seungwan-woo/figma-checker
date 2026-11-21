import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { figmaNodeLink, parseFigmaTarget } from './figma.js';
import { asRecord } from './types.js';

export function publicFigmaTarget(value: unknown) {
  if (typeof value !== 'string') return null;
  const target = parseFigmaTarget(value);
  if (target._tag === 'Left') return null;
  const { fileKey, nodeId } = target.right;
  return { fileKey, nodeId, url: figmaNodeLink(target.right, nodeId) };
}

export function preparePublicReport(value: unknown, allowLive = false) {
  const report = asRecord(value);
  if (report?.schemaVersion !== 1 || report.status !== 'complete'
      || (report.mode !== 'fixture' && !(allowLive && report.mode === 'live'))) {
    throw new Error('Pages accepts completed fixture reports or explicitly enabled live reports with schema version 1.');
  }
  const { createdAt, metrics, findings, mode } = report;
  const target = mode === 'live' ? publicFigmaTarget(report.targetUrl) : null;
  const version = asRecord(report.snapshot)?.figmaVersion;
  if (mode === 'live' && !target) throw new Error('A live report requires a valid Figma target URL.');
  if (typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt)) || !Array.isArray(metrics)
      || !Array.isArray(findings)) {
    throw new Error('Invalid fixture report.');
  }
  const metric = metrics.map(asRecord).find((entry) => entry?.id === 'auto-layout-adoption');
  const { enabled, eligible, percentage, version: metricVersion } = metric ?? {};
  if (typeof enabled !== 'number' || typeof eligible !== 'number' || !Number.isSafeInteger(enabled)
      || !Number.isSafeInteger(eligible) || enabled < 0 || enabled > eligible
      || (eligible === 0 ? percentage !== null : typeof percentage !== 'number'
        || !Number.isFinite(percentage) || percentage < 0 || percentage > 100)) {
    throw new Error('Invalid fixture adoption metric.');
  }
  const namingRule = Array.isArray(report.rules)
    ? report.rules.map(asRecord).find((rule) => rule?.id === 'default-frame-name')
    : undefined;
  const rules = typeof namingRule?.enabled === 'boolean' && typeof namingRule.evaluated === 'number'
    && Number.isSafeInteger(namingRule.evaluated) && namingRule.evaluated >= 0
    ? [{ id: 'default-frame-name', enabled: namingRule.enabled, evaluated: namingRule.evaluated,
      version: positiveVersion(namingRule.version) }]
    : [];
  const advisories = findings.map((entry: unknown) => {
    const finding = asRecord(entry);
    if (!finding || typeof finding.ruleId !== 'string' || typeof finding.nodeId !== 'string'
        || typeof finding.nodeName !== 'string') {
      throw new Error('Invalid fixture finding.');
    }
    const link = target ? publicFigmaTarget(finding.url) : null;
    return {
      ruleId: finding.ruleId, nodeId: finding.nodeId, nodeName: finding.nodeName,
      url: link?.fileKey === target?.fileKey && link?.nodeId === finding.nodeId ? link?.url : undefined,
    };
  });
  // Only publish selected fields and canonical links on this public PoC.
  return {
    schemaVersion: 1,
    status: 'complete',
    mode: mode === 'live' ? 'live' : 'fixture',
    createdAt: new Date(createdAt).toISOString(),
    scope: target ? `${target.fileKey}:${target.nodeId}` : 'fixture',
    targetUrl: target?.url ?? null,
    configHash: typeof report.configHash === 'string' && /^[a-f0-9]{64}$/.test(report.configHash) ? report.configHash : null,
    snapshot: { figmaVersion: typeof version === 'string' ? version : null },
    metrics: [{ id: 'auto-layout-adoption', version: positiveVersion(metricVersion), enabled, eligible,
      percentage: percentage as number | null }],
    rules,
    findings: advisories,
  } as const;
}

function positiveVersion(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 1;
}

export function namingStatus(report: ReturnType<typeof preparePublicReport>): string {
  const rule = report.rules[0];
  if (rule?.enabled === false) return '규칙 꺼짐';
  if (rule?.evaluated === 0) return '검사 대상 없음';
  return `${new Intl.NumberFormat('ko-KR').format(report.findings.length)}건`;
}

export function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul',
  }).format(new Date(value));
}

export function renderReport(report: ReturnType<typeof preparePublicReport>, historyMarkup = ''): string {
  const [metric] = report.metrics;
  const date = new Date(report.createdAt);
  const updatedAt = formatDate(report.createdAt);
  const label = report.mode === 'live' ? '최근 성공한 Figma 검사' : '샘플 보고서';
  const number = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });
  const metricValue = metric.percentage === null
    ? '<span class="unavailable">측정 대상 없음</span>'
    : `${number.format(metric.percentage)}%`;
  const meter = metric.percentage === null ? ''
    : `<meter min="0" max="100" value="${metric.percentage}" aria-label="Auto Layout 적용률">${metricValue}</meter>`;
  const findings = report.findings.length > 0
    ? `<ul>${report.findings.map((finding) => `<li><strong>${escapeHtml(finding.nodeName)}</strong>
      <span>기본 이름 · 노드 ${finding.url
        ? `<a href="${escapeHtml(finding.url)}"><code>${escapeHtml(finding.nodeId)}</code></a>`
        : `<code>${escapeHtml(finding.nodeId)}</code>`}</span></li>`).join('')}</ul>` : '';

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Figma Checker · ${label}</title>
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <main>
    <header>
      <p class="eyebrow">${label}</p>
      <h1>Figma Checker</h1>
      <p>Auto Layout 사용과 기본 이름이 남은 프레임을 확인합니다.</p>
      <div class="report-meta">
        <span>생성 <time datetime="${date.toISOString()}">${escapeHtml(updatedAt)}</time> (KST)</span>
        <a href="./report.json" download>보고서 JSON 다운로드</a>
        ${report.targetUrl ? `<a href="${escapeHtml(report.targetUrl)}">Figma에서 대상 열기</a>` : ''}
      </div>
    </header>
    <div class="report">
      <section aria-labelledby="adoption">
        <h2 id="adoption">Auto Layout 적용률</h2>
        <p class="metric">${metricValue}</p>
        ${meter}
        <p>적용 ${number.format(metric.enabled)} / ${number.format(metric.eligible)}개 컨테이너</p>
      </section>
      <section aria-labelledby="naming">
        <h2 id="naming">프레임 이름 검토</h2>
        <p class="metric">${namingStatus(report)}</p>
        ${findings}
      </section>
    </div>
    ${historyMarkup}
  </main>
</body>
</html>\n`;
}

export async function writeSite(
  report: ReturnType<typeof preparePublicReport>,
  history?: { markup: string; json: string },
) {
  await mkdir('pages-dist', { recursive: true });
  await Promise.all([
    writeFile('pages-dist/index.html', renderReport(report, history?.markup)),
    writeFile('pages-dist/report.json', `${JSON.stringify(report, null, 2)}\n`),
    copyFile('site/style.css', 'pages-dist/style.css'),
    history ? writeFile('pages-dist/history.json', history.json) : rm('pages-dist/history.json', { force: true }),
  ]);
}

if (import.meta.main) {
  const sourcePath = process.argv[2];
  if (!sourcePath) throw new Error('Usage: node dist/pages.js <fixture-report.json>');
  await writeSite(preparePublicReport(JSON.parse(await readFile(sourcePath, 'utf8'))));
}
