import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { asRecord } from './types.js';

export function preparePublicReport(value: unknown) {
  const report = asRecord(value);
  if (report?.schemaVersion !== 1 || report.status !== 'complete' || report.mode !== 'fixture') {
    throw new Error('Pages accepts only completed fixture reports with schema version 1.');
  }
  const { createdAt, metrics, findings } = report;
  if (typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt)) || !Array.isArray(metrics)
      || !Array.isArray(findings)) {
    throw new Error('Invalid fixture report.');
  }
  const metric = metrics.map(asRecord).find((entry) => entry?.id === 'auto-layout-adoption');
  const { enabled, eligible, percentage } = metric ?? {};
  if (typeof enabled !== 'number' || typeof eligible !== 'number' || !Number.isSafeInteger(enabled)
      || !Number.isSafeInteger(eligible) || enabled < 0 || enabled > eligible
      || (eligible === 0 ? percentage !== null : typeof percentage !== 'number'
        || !Number.isFinite(percentage) || percentage < 0 || percentage > 100)) {
    throw new Error('Invalid fixture adoption metric.');
  }
  const advisories = findings.map((entry: unknown) => {
    const finding = asRecord(entry);
    if (!finding || typeof finding.ruleId !== 'string' || typeof finding.nodeId !== 'string'
        || typeof finding.nodeName !== 'string') {
      throw new Error('Invalid fixture finding.');
    }
    return { ruleId: finding.ruleId, nodeId: finding.nodeId, nodeName: finding.nodeName };
  });
  // The public projection omits source metadata and Figma URLs.
  return {
    schemaVersion: 1,
    status: 'complete',
    mode: 'fixture',
    createdAt,
    metrics: [{ id: 'auto-layout-adoption', enabled, eligible, percentage: percentage as number | null }],
    findings: advisories,
  } as const;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function renderReport(report: ReturnType<typeof preparePublicReport>): string {
  const [metric] = report.metrics;
  const date = new Date(report.createdAt);
  const updatedAt = new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul',
  }).format(date);
  const number = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });
  const metricValue = metric.percentage === null
    ? '<span class="unavailable">측정 대상 없음</span>'
    : `${number.format(metric.percentage)}%`;
  const meter = metric.percentage === null ? ''
    : `<meter min="0" max="100" value="${metric.percentage}" aria-label="Auto Layout 적용률">${metricValue}</meter>`;
  const findings = report.findings.length === 0
    ? '<p>이름을 검토할 프레임이 없습니다.</p>'
    : `<ul>${report.findings.map((finding) => `<li><strong>${escapeHtml(finding.nodeName)}</strong>
      <span>기본 이름 · 샘플 노드 <code>${escapeHtml(finding.nodeId)}</code></span></li>`).join('')}</ul>`;

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Figma Checker · 샘플 보고서</title>
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <main>
    <header>
      <p class="eyebrow">샘플 보고서</p>
      <h1>Figma Checker</h1>
      <p>샘플 디자인에서 Auto Layout 사용과 기본 이름이 남은 프레임을 확인합니다.</p>
      <div class="report-meta">
        <span>생성 <time datetime="${date.toISOString()}">${escapeHtml(updatedAt)}</time> (KST)</span>
        <a href="./report.json" download>보고서 JSON 다운로드</a>
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
        <p class="metric">${number.format(report.findings.length)}건</p>
        ${findings}
      </section>
    </div>
  </main>
</body>
</html>\n`;
}

if (import.meta.main) {
  const sourcePath = process.argv[2];
  if (!sourcePath) throw new Error('Usage: node dist/pages.js <fixture-report.json>');
  const report = preparePublicReport(JSON.parse(await readFile(sourcePath, 'utf8')));
  await mkdir('pages-dist', { recursive: true });
  await Promise.all([
    writeFile('pages-dist/index.html', renderReport(report)),
    writeFile('pages-dist/report.json', `${JSON.stringify(report, null, 2)}\n`),
    copyFile('site/style.css', 'pages-dist/style.css'),
  ]);
}
