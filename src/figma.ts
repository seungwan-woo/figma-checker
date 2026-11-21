import * as E from 'fp-ts/lib/Either.js';
import * as TE from 'fp-ts/lib/TaskEither.js';
import type { CheckError } from './types.js';
import { asRecord } from './types.js';

const nodeIdPattern = /^I?\d+:\d+(?:;I?\d+:\d+)*$/;
const layoutModes = ['NONE', 'HORIZONTAL', 'VERTICAL', 'GRID'] as const;
const maxResponseBytes = 16 * 1024 * 1024;

type LayoutMode = typeof layoutModes[number];

export type FigmaTarget = {
  readonly fileKey: string;
  readonly nodeId: string;
  readonly designUrl: string;
};

export type Layer = {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly visible: boolean;
  readonly layoutMode: LayoutMode;
  readonly componentId?: string;
  readonly children: readonly Layer[];
};

export type Snapshot = {
  readonly figmaVersion: string;
  readonly root: Layer;
  readonly componentReferences: ReadonlyMap<string, 'valid' | 'invalid'> | null;
};

const invalidUrl = { code: 'INVALID_FIGMA_URL', message: 'Provide an HTTPS Figma Design URL.' };
const invalidResponse = { code: 'INVALID_FIGMA_RESPONSE', message: 'The response did not contain a valid Figma node snapshot.' };

export function isFigmaNodeId(value: unknown): value is string {
  return typeof value === 'string' && nodeIdPattern.test(value);
}

export function isVirtualFigmaNodeId(value: string): boolean {
  return value.startsWith('I') || value.includes(';');
}

export function* layersInTree(root: Layer): Generator<Layer> {
  const pending = [root];
  for (let layer = pending.pop(); layer; layer = pending.pop()) {
    yield layer;
    for (const child of layer.children.toReversed()) pending.push(child);
  }
}

export function parseFigmaTarget(value: string): E.Either<CheckError, FigmaTarget> {
  const url = URL.parse(value);
  if (!url || url.protocol !== 'https:' || !['figma.com', 'www.figma.com'].includes(url.hostname)
      || url.username || url.password || url.port) {
    return E.left(invalidUrl);
  }
  const [, kind, mainKey, segment, branchKey] = url.pathname.split('/');
  const fileKey = segment === 'branch' && branchKey ? branchKey : mainKey;
  if ((kind !== 'design' && kind !== 'file') || !fileKey || !mainKey
      || !/^[a-zA-Z0-9]+$/.test(fileKey) || !/^[a-zA-Z0-9]+$/.test(mainKey)) {
    return E.left(invalidUrl);
  }

  const ids = url.searchParams.getAll('node-id');
  if (ids.length === 0) {
    return E.left({ code: 'NODE_ID_REQUIRED', message: 'For this pilot, copy the link to a Figma page or node.' });
  }
  const nodeId = ids[0]?.replaceAll('-', ':');
  if (ids.length !== 1 || !isFigmaNodeId(nodeId)) return E.left(invalidUrl);

  // Preserve Figma's path but strip share parameters and the fragment.
  return E.right({ fileKey, nodeId, designUrl: `${url.origin}${url.pathname}` });
}

export function figmaNodeLink(target: FigmaTarget, nodeId: string): string {
  const url = new URL(target.designUrl);
  url.searchParams.set('node-id', nodeId.replaceAll(':', '-'));
  return url.toString();
}

type DraftLayer = Omit<Layer, 'children'> & { children: Layer[] };

function decodeLayer(value: unknown): { layer: DraftLayer; children: unknown[] } | undefined {
  const object = asRecord(value);
  if (!object) return undefined;
  const { id, type, name, visible, layoutMode = 'NONE', children = [] } = object;
  const mode = layoutModes.find((candidate) => candidate === layoutMode);
  if (!isFigmaNodeId(id) || typeof type !== 'string' || !type
      || typeof name !== 'string' || (visible !== undefined && typeof visible !== 'boolean')
      || !mode || !Array.isArray(children)) {
    return undefined;
  }
  const componentId = type === 'INSTANCE' && nonblankString(object.componentId) ? object.componentId : undefined;
  return { layer: { id, type, name, visible: visible ?? true, layoutMode: mode, componentId, children: [] }, children };
}

function nonblankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function decodeComponentReferences(value: unknown): Snapshot['componentReferences'] {
  const components = asRecord(value);
  if (!components) return null;
  const references = new Map<string, 'valid' | 'invalid'>();
  for (const [id, value] of Object.entries(components)) {
    const component = asRecord(value);
    const valid = component && Object.hasOwn(component, 'key') && nonblankString(component.key);
    references.set(id, valid ? 'valid' : 'invalid');
  }
  return references;
}

export function decodeSnapshot(value: unknown, nodeId: string): E.Either<CheckError, Snapshot> {
  const data = asRecord(value);
  const nodes = asRecord(data?.nodes);
  const figmaVersion = data?.version;
  if (!nodes || typeof figmaVersion !== 'string' || !figmaVersion) return E.left(invalidResponse);

  const entry = nodes[nodeId];
  if (entry === null || entry === undefined) {
    return E.left({ code: 'NODE_NOT_FOUND', message: 'The selected node was not returned. Check the copied link and file access.' });
  }
  const envelope = asRecord(entry);
  const root = decodeLayer(envelope?.document);
  if (!root || root.layer.id !== nodeId) return E.left(invalidResponse);

  const pending = [root];
  for (let current = pending.pop(); current; current = pending.pop()) {
    for (const rawChild of current.children) {
      const child = decodeLayer(rawChild);
      if (!child) return E.left(invalidResponse);
      current.layer.children.push(child.layer);
      pending.push(child);
    }
  }
  return E.right({ figmaVersion, root: root.layer, componentReferences: decodeComponentReferences(envelope?.components) });
}

function retryAfterSeconds(header: string | null): number | undefined {
  if (!header) return undefined;
  if (/^\d+$/.test(header)) {
    const seconds = Number(header);
    return Number.isSafeInteger(seconds) ? seconds : undefined;
  }
  const when = Date.parse(header);
  return Number.isFinite(when) ? Math.max(0, Math.ceil((when - Date.now()) / 1000)) : undefined;
}

function httpError(response: Response): CheckError {
  const httpStatus = response.status;
  if (httpStatus === 429) {
    return {
      code: 'FIGMA_RATE_LIMIT', message: 'Figma rate limit reached. Check quota before trying again.',
      httpStatus, retryAfterSeconds: retryAfterSeconds(response.headers.get('retry-after')),
    };
  }
  if ([401, 403, 404].includes(httpStatus)) {
    return { code: 'FIGMA_ACCESS', message: 'Check the target link, token scope, and draft access.', httpStatus };
  }
  return { code: 'FIGMA_HTTP_ERROR', message: 'Figma returned an unsuccessful response.', httpStatus };
}

async function readBoundedBody(response: Response): Promise<Buffer | undefined> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks, size);
      size += value.byteLength;
      if (size > maxResponseBytes) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

export function fetchSnapshot(
  target: FigmaTarget,
  token: string,
  transport: typeof fetch = fetch,
): TE.TaskEither<CheckError, Snapshot> {
  return async () => {
    const endpoint = new URL(`https://api.figma.com/v1/files/${encodeURIComponent(target.fileKey)}/nodes`);
    endpoint.searchParams.set('ids', target.nodeId);
    let body: Buffer | undefined;
    try {
      const response = await transport(endpoint, {
        headers: { 'X-Figma-Token': token }, redirect: 'error', signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return E.left(httpError(response));
      }
      body = await readBoundedBody(response);
    } catch {
      return E.left({ code: 'FIGMA_NETWORK', message: 'Could not reach Figma or read the response before the timeout.' });
    }
    if (!body) {
      return E.left({ code: 'FIGMA_RESPONSE_TOO_LARGE', message: 'The selected subtree exceeds the pilot response limit.' });
    }
    return E.flatMap((raw: unknown) => decodeSnapshot(raw, target.nodeId))(
      E.tryCatch((): unknown => JSON.parse(body.toString('utf8')), () => invalidResponse),
    );
  };
}
