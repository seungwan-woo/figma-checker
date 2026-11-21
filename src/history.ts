import { readFile, writeFile } from 'node:fs/promises';
import { escapeHtml, formatDate, namingStatus, preparePublicReport, publicFigmaTarget, writeSite } from './pages.js';
import { asRecord } from './types.js';

type PublicReport = ReturnType<typeof preparePublicReport>;
type FailedRun = {
  schemaVersion: 1;
  status: 'error';
  mode: 'live' | 'fixture';
  createdAt: string;
  scope: string;
  targetUrl: string | null;
  error: { code: string; httpStatus?: number };
};
type HistoryEntry = { id: string; report: PublicReport | FailedRun };
const maxEntries = 100;
const maxHistoryBytes = 32 * 1024 * 1024;

function prepareAttempt(id: unknown, value: unknown): HistoryEntry {
  const report = asRecord(value);
  if (typeof id !== 'string' || !/^\d+(?:-\d+)?$/.test(id) || !report || report.schemaVersion !== 1
      || (report.mode !== 'fixture' && report.mode !== 'live')) {
    throw new Error('Invalid Actions history entry.');
  }
  if (report.status === 'complete') return { id, report: preparePublicReport(report, true) };

  const { createdAt, mode } = report;
  const error = asRecord(report.error);
  if (report.status !== 'error' || typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))
      || typeof error?.code !== 'string' || !/^[A-Z0-9_]{1,64}$/.test(error.code)) {
    throw new Error('Invalid failed Figma report.');
  }
  const target = mode === 'live' ? publicFigmaTarget(report.targetUrl) : null;
  const { httpStatus } = error;
  return {
    id,
    report: {
      schemaVersion: 1, status: 'error', mode, createdAt: new Date(createdAt).toISOString(),
      scope: mode === 'fixture' ? 'fixture' : target ? `${target.fileKey}:${target.nodeId}` : 'live:unknown',
      targetUrl: target?.url ?? null,
      error: {
        code: error.code,
        httpStatus: typeof httpStatus === 'number' && Number.isInteger(httpStatus)
          && httpStatus >= 400 && httpStatus <= 599 ? httpStatus : undefined,
      },
    },
  };
}

function newestFirst(a: HistoryEntry, b: HistoryEntry): number {
  return b.report.createdAt.localeCompare(a.report.createdAt) || b.id.localeCompare(a.id);
}

export function readHistory(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) throw new Error('Invalid report history.');
  const entries = value.map((entry: unknown) => {
    const item = asRecord(entry);
    return prepareAttempt(item?.id, item?.report);
  });
  if (new Set(entries.map(({ id }) => id)).size !== entries.length) throw new Error('Duplicate Actions attempts in history.');
  return entries.sort(newestFirst);
}

export function addAttempt(history: readonly HistoryEntry[], id: string, value: unknown): HistoryEntry[] {
  const entries = [...history.filter((entry) => entry.id !== id), prepareAttempt(id, value)].sort(newestFirst);
  const retained: HistoryEntry[] = [];
  let bytes = 5;
  for (const entry of entries.slice(0, maxEntries)) {
    bytes += Buffer.byteLength(JSON.stringify(entry)) + 2;
    if (bytes > maxHistoryBytes) break;
    retained.push(entry);
  }
  if (!retained.some((entry) => entry.id === id)) throw new Error('The report exceeds the retained history window.');
  return retained;
}

export function selectReport(history: readonly HistoryEntry[], sample: PublicReport): PublicReport {
  const successes = history.flatMap(({ report }) => report.status === 'complete' ? [report] : []);
  return successes.find((report) => report.mode === 'live') ?? successes[0] ?? sample;
}

function historyRow({ report }: HistoryEntry): string {
  const time = `<time datetime="${report.createdAt}">${escapeHtml(formatDate(report.createdAt))}</time>`;
  if (report.status === 'error') {
    const status = report.error.httpStatus ? ` (HTTP ${report.error.httpStatus})` : '';
    return `<tr><td>${time}</td><td colspan="3">실패 · <code>${escapeHtml(report.error.code)}</code>${status}</td></tr>`;
  }
  const [metric] = report.metrics;
  const adoption = metric.percentage === null ? '측정 대상 없음' : `${metric.percentage}% (${metric.enabled}/${metric.eligible})`;
  return `<tr><td>${time}</td><td>${adoption}</td><td>${namingStatus(report)}</td>
    <td>${escapeHtml(report.snapshot.figmaVersion ?? '—')}</td></tr>`;
}

function groupEntries(history: readonly HistoryEntry[], key: (entry: HistoryEntry) => string) {
  const groups = new Map<string, HistoryEntry[]>();
  for (const entry of history) {
    const group = key(entry);
    const entries = groups.get(group) ?? [];
    entries.push(entry);
    groups.set(group, entries);
  }
  return [...groups.values()];
}

function historySeries(entries: HistoryEntry[]): string {
  const groups = groupEntries(entries, ({ report }) => report.status === 'error' ? 'errors'
    : `${report.metrics[0].version}:${report.configHash}:${report.rules[0]?.version ?? ''}`);
  return groups.map((group) => {
    const first = group[0]?.report;
    if (!first) return '';
    const label = first.status === 'error' ? '실패한 실행' : [
      `측정 기준 v${first.metrics[0].version}`,
      first.rules[0] ? `이름 규칙 v${first.rules[0].version}` : null,
      first.configHash?.slice(0, 8),
    ].filter(Boolean).join(' · ');
    return `<div class="history-table"><table><caption>${label}</caption>
      <thead><tr><th scope="col">실행 시각 (KST)</th><th scope="col">Auto Layout</th>
      <th scope="col">이름 린트</th><th scope="col">Figma 버전</th></tr></thead>
      <tbody>${group.map(historyRow).join('')}</tbody></table></div>`;
  }).join('');
}

export function renderHistory(history: readonly HistoryEntry[]): string {
  const tables = groupEntries(history, (entry) => entry.report.scope).map((entries) => {
    const first = entries[0]?.report;
    if (!first) return '';
    const target = publicFigmaTarget(first.targetUrl);
    const title = first.mode === 'fixture' ? '샘플 실행' : target
      ? `<a href="${escapeHtml(target.url)}">Figma 대상 <code>${escapeHtml(target.nodeId)}</code></a>`
      : '대상을 확인할 수 없는 실행';
    return `<h3>${title}</h3>${historySeries(entries)}`;
  }).join('');
  return `<section class="history" aria-labelledby="history"><h2 id="history">검사 이력</h2>
    <a href="./history.json" download>이력 JSON 다운로드</a>
    ${tables || '<p>기록된 수동 실행이 없습니다.</p>'}</section>`;
}

if (import.meta.main) {
  const [command, path, reportPath, id] = process.argv.slice(2);
  if (!path || !reportPath || (command !== 'append' && command !== 'build')) {
    throw new Error('Usage: history <append|build> <history.json> <report.json> [actions-attempt-id]');
  }
  const stored = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return '[]';
    throw error;
  });
  const history = readHistory(JSON.parse(stored));
  const report: unknown = JSON.parse(await readFile(reportPath, 'utf8'));
  const json = (entries: readonly HistoryEntry[]) => `[\n${entries.map((entry) => JSON.stringify(entry)).join(',\n')}\n]\n`;
  if (command === 'append') {
    if (!id) throw new Error('An Actions attempt ID is required to append history.');
    await writeFile(path, json(addAttempt(history, id, report)));
  } else {
    await writeSite(selectReport(history, preparePublicReport(report)), { markup: renderHistory(history), json: json(history) });
  }
}
