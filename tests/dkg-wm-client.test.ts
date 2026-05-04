import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DkgWmClient, DkgAuthError, DkgUnavailableError, DkgApiError } from '../src/modules/dkg-wm-client.js';

const DAEMON = 'http://127.0.0.1:9200';
const TOKEN = 'test-bearer-token';

function makeClient(opts: Partial<ConstructorParameters<typeof DkgWmClient>[0]> = {}): DkgWmClient {
  return new DkgWmClient({ daemonUrl: DAEMON, token: TOKEN, ...opts });
}

function mockFetch(responses: Array<{ ok: boolean; status: number; body?: unknown }>) {
  let callIndex = 0;
  return vi.fn().mockImplementation(async () => {
    const resp = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    const body = JSON.stringify(resp.body ?? {});
    return { ok: resp.ok, status: resp.status, text: async () => body };
  });
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------------------
// Context Graph
// ---------------------------------------------------------------------------
describe('ensureContextGraph', () => {
  it('creates CG via single idempotent POST', async () => {
    vi.stubGlobal('fetch', mockFetch([{ ok: true, status: 200, body: {} }]));
    await makeClient().ensureContextGraph('wm-artifacts');
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('swallows 409 "already exists" error', async () => {
    vi.stubGlobal('fetch', mockFetch([{ ok: false, status: 409, body: { error: 'context graph already exists' } }]));
    await expect(makeClient().ensureContextGraph('wm-artifacts')).resolves.toBeUndefined();
  });

  it('swallows 400 "already registered" error', async () => {
    vi.stubGlobal('fetch', mockFetch([{ ok: false, status: 400, body: { error: 'context graph already registered' } }]));
    await expect(makeClient().ensureContextGraph('wm-artifacts')).resolves.toBeUndefined();
  });

  it('rethrows 400 that is NOT "already exists"', async () => {
    vi.stubGlobal('fetch', mockFetch([{ ok: false, status: 400, body: { error: 'invalid id format' } }]));
    await expect(makeClient().ensureContextGraph('bad-id')).rejects.toThrow(DkgApiError);
  });

  it('passes optional name to createContextGraph', async () => {
    const mockFn = mockFetch([{ ok: true, status: 200 }]);
    vi.stubGlobal('fetch', mockFn);
    await makeClient().ensureContextGraph('my-cg', 'My Context Graph');
    const [, init] = mockFn.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { id: string; name: string };
    expect(body.id).toBe('my-cg');
    expect(body.name).toBe('My Context Graph');
  });
});

// ---------------------------------------------------------------------------
// createAssertion
// ---------------------------------------------------------------------------
describe('createAssertion', () => {
  it('returns assertionUri on success', async () => {
    vi.stubGlobal('fetch', mockFetch([{ ok: true, status: 200, body: { assertionUri: 'ual:test:abc' } }]));
    const receipt = await makeClient().createAssertion('wm-artifacts', 'artifacts');
    expect(receipt.assertionUri).toBe('ual:test:abc');
  });

  it('calls POST /api/assertion/create', async () => {
    const mockFn = mockFetch([{ ok: true, status: 200, body: {} }]);
    vi.stubGlobal('fetch', mockFn);
    await makeClient().createAssertion('wm-artifacts', 'artifacts');
    const [url, init] = mockFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/assertion/create');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as { contextGraphId: string; name: string };
    expect(body.contextGraphId).toBe('wm-artifacts');
    expect(body.name).toBe('artifacts');
  });

  it('returns { alreadyExists: true } on 409', async () => {
    vi.stubGlobal('fetch', mockFetch([{ ok: false, status: 409, body: { error: 'assertion already exists' } }]));
    const receipt = await makeClient().createAssertion('wm-artifacts', 'artifacts');
    expect(receipt.alreadyExists).toBe(true);
  });

  it('returns { alreadyExists: true } on 400 "already exists"', async () => {
    vi.stubGlobal('fetch', mockFetch([{ ok: false, status: 400, body: { error: 'assertion already exists' } }]));
    const receipt = await makeClient().createAssertion('wm-artifacts', 'artifacts');
    expect(receipt.alreadyExists).toBe(true);
  });

  it('rethrows 400 that is NOT "already exists"', async () => {
    vi.stubGlobal('fetch', mockFetch([{ ok: false, status: 400, body: { error: 'invalid name format' } }]));
    await expect(makeClient().createAssertion('wm-artifacts', 'bad!')).rejects.toThrow(DkgApiError);
  });
});

// ---------------------------------------------------------------------------
// writeAssertion
// ---------------------------------------------------------------------------
describe('writeAssertion', () => {
  it('calls POST /api/assertion/{name}/write with quads', async () => {
    const mockFn = mockFetch([{ ok: true, status: 200, body: { written: 2 } }]);
    vi.stubGlobal('fetch', mockFn);
    await makeClient().writeAssertion('wm-artifacts', 'artifacts', [
      { subject: 'urn:s1', predicate: 'urn:p', object: '"val1"' },
      { subject: 'urn:s2', predicate: 'urn:p', object: '"val2"' },
    ]);
    const [url, init] = mockFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/assertion/artifacts/write');
    const body = JSON.parse(init.body as string) as { contextGraphId: string; quads: unknown[] };
    expect(body.contextGraphId).toBe('wm-artifacts');
    expect(body.quads).toHaveLength(2);
  });

  it('URL-encodes special characters in assertion name', async () => {
    vi.stubGlobal('fetch', mockFetch([{ ok: true, status: 200 }]));
    await makeClient().writeAssertion('wm-artifacts', 'my assertion', []);
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain('my%20assertion');
  });
});

// ---------------------------------------------------------------------------
// createOrWriteAssertion
// ---------------------------------------------------------------------------
describe('createOrWriteAssertion', () => {
  it('creates then writes when assertionExists=false, returns ual', async () => {
    const mockFn = mockFetch([
      { ok: true, status: 200, body: { assertionUri: 'ual:create:abc' } },
      { ok: true, status: 200, body: { written: 1 } },
    ]);
    vi.stubGlobal('fetch', mockFn);
    const result = await makeClient().createOrWriteAssertion({
      contextGraphId: 'wm-artifacts',
      name: 'artifacts',
      quads: [{ subject: 'urn:s', predicate: 'urn:p', object: '"o"' }],
      assertionExists: false,
    });
    expect(mockFn.mock.calls).toHaveLength(2);
    expect(result.ual).toBe('ual:create:abc');
  });

  it('only writes when assertionExists=true', async () => {
    const mockFn = mockFetch([{ ok: true, status: 200, body: { written: 1 } }]);
    vi.stubGlobal('fetch', mockFn);
    await makeClient().createOrWriteAssertion({
      contextGraphId: 'wm-artifacts',
      name: 'artifacts',
      quads: [{ subject: 'urn:s', predicate: 'urn:p', object: '"o"' }],
      assertionExists: true,
    });
    const [url] = mockFn.mock.calls[0] as [string];
    expect(url).toContain('/api/assertion/artifacts/write');
    expect(mockFn.mock.calls).toHaveLength(1);
  });

  it('falls through to write when createAssertion returns alreadyExists=true', async () => {
    // createAssertion returns 409 → alreadyExists → skip the first write, go to the write path
    const mockFn = mockFetch([
      { ok: false, status: 409, body: { error: 'assertion already exists' } }, // createAssertion
      { ok: true, status: 200, body: { written: 1 } },                         // writeAssertion
    ]);
    vi.stubGlobal('fetch', mockFn);
    const result = await makeClient().createOrWriteAssertion({
      contextGraphId: 'wm-artifacts',
      name: 'artifacts',
      quads: [{ subject: 'urn:s', predicate: 'urn:p', object: '"o"' }],
      assertionExists: false,
    });
    // ual is undefined because createAssertion returned alreadyExists
    expect(result.ual).toBeUndefined();
    expect(mockFn.mock.calls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// queryAssertion
// ---------------------------------------------------------------------------
describe('queryAssertion', () => {
  it('calls POST /api/assertion/{name}/query with contextGraphId', async () => {
    const quads = [{ subject: 'urn:s', predicate: 'urn:p', object: '"o"' }];
    const mockFn = mockFetch([{ ok: true, status: 200, body: { quads, count: 1 } }]);
    vi.stubGlobal('fetch', mockFn);

    const result = await makeClient().queryAssertion('wm-artifacts', 'artifacts');

    const [url, init] = mockFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/assertion/artifacts/query');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as { contextGraphId: string };
    expect(body.contextGraphId).toBe('wm-artifacts');
    expect(result).toEqual({ quads, count: 1 });
  });
});

// ---------------------------------------------------------------------------
// getAssertionHistory
// ---------------------------------------------------------------------------
describe('getAssertionHistory', () => {
  it('calls GET /api/assertion/{name}/history with contextGraphId query param', async () => {
    const mockFn = mockFetch([{ ok: true, status: 200, body: { history: [] } }]);
    vi.stubGlobal('fetch', mockFn);

    await makeClient().getAssertionHistory('wm-artifacts', 'artifacts');

    const [url] = mockFn.mock.calls[0] as [string];
    expect(url).toContain('/api/assertion/artifacts/history');
    expect(url).toContain('contextGraphId=wm-artifacts');
  });
});

// ---------------------------------------------------------------------------
// promoteAssertion
// ---------------------------------------------------------------------------
describe('promoteAssertion', () => {
  it('calls POST /api/assertion/{name}/promote with contextGraphId', async () => {
    const mockFn = mockFetch([{ ok: true, status: 200, body: {} }]);
    vi.stubGlobal('fetch', mockFn);

    await makeClient().promoteAssertion('wm-artifacts', 'artifacts');

    const [url, init] = mockFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/assertion/artifacts/promote');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as { contextGraphId: string };
    expect(body.contextGraphId).toBe('wm-artifacts');
  });

  it('logs info when logger is provided', async () => {
    vi.stubGlobal('fetch', mockFetch([{ ok: true, status: 200 }]));
    const infoFn = vi.fn();
    const client = makeClient({ logger: { info: infoFn, warn: vi.fn(), error: vi.fn(), debug: vi.fn() } });
    await client.promoteAssertion('wm-artifacts', 'artifacts');
    expect(infoFn).toHaveBeenCalledWith(expect.stringContaining('promoted'));
  });
});

// ---------------------------------------------------------------------------
// querySparql
// ---------------------------------------------------------------------------
describe('querySparql', () => {
  it('calls POST /api/query with sparql, view, and contextGraphId', async () => {
    const mockFn = mockFetch([{ ok: true, status: 200, body: { results: [] } }]);
    vi.stubGlobal('fetch', mockFn);

    await makeClient().querySparql('SELECT * WHERE { ?s ?p ?o }', {
      contextGraphId: 'wm-artifacts',
      view: 'working-memory',
    });

    const [url, init] = mockFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/query');
    const body = JSON.parse(init.body as string) as { sparql: string; view: string; contextGraphId: string };
    expect(body.sparql).toContain('SELECT');
    expect(body.view).toBe('working-memory');
    expect(body.contextGraphId).toBe('wm-artifacts');
  });

  it('defaults to view=working-memory when not specified', async () => {
    vi.stubGlobal('fetch', mockFetch([{ ok: true, status: 200, body: {} }]));
    await makeClient().querySparql('SELECT * WHERE { ?s ?p ?o }');
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { view: string };
    expect(body.view).toBe('working-memory');
  });
});

// ---------------------------------------------------------------------------
// getStatus
// ---------------------------------------------------------------------------
describe('getStatus', () => {
  it('calls GET /api/status', async () => {
    const mockFn = mockFetch([{ ok: true, status: 200, body: { version: '10.0.0' } }]);
    vi.stubGlobal('fetch', mockFn);

    const result = await makeClient().getStatus();

    const [url] = mockFn.mock.calls[0] as [string];
    expect(url).toContain('/api/status');
    expect(result).toEqual({ version: '10.0.0' });
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
describe('error handling', () => {
  it('throws DkgAuthError on 401', async () => {
    vi.stubGlobal('fetch', mockFetch([{ ok: false, status: 401 }]));
    await expect(makeClient().createContextGraph('test')).rejects.toThrow(DkgAuthError);
  });

  it('throws DkgUnavailableError on 503', async () => {
    vi.stubGlobal('fetch', mockFetch([{ ok: false, status: 503 }]));
    await expect(makeClient().createContextGraph('test')).rejects.toThrow(DkgUnavailableError);
  });

  it('throws DkgUnavailableError on 502', async () => {
    vi.stubGlobal('fetch', mockFetch([{ ok: false, status: 502 }]));
    await expect(makeClient().createContextGraph('test')).rejects.toThrow(DkgUnavailableError);
  });

  it('throws DkgUnavailableError on ECONNREFUSED', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(makeClient().createContextGraph('test')).rejects.toThrow(DkgUnavailableError);
  });

  it('throws DkgUnavailableError on fetch failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')));
    await expect(makeClient().createContextGraph('test')).rejects.toThrow(DkgUnavailableError);
  });

  it('rethrows unknown errors that are not network-related', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('unexpected type')));
    await expect(makeClient().createContextGraph('test')).rejects.toThrow(TypeError);
  });

  it('throws DkgApiError on generic 4xx', async () => {
    vi.stubGlobal('fetch', mockFetch([{ ok: false, status: 422, body: { error: 'validation failed' } }]));
    await expect(makeClient().createContextGraph('test')).rejects.toThrow(DkgApiError);
  });

  it('DkgApiError carries the statusCode', async () => {
    vi.stubGlobal('fetch', mockFetch([{ ok: false, status: 422 }]));
    const err = await makeClient().createContextGraph('test').catch(e => e) as DkgApiError;
    expect(err).toBeInstanceOf(DkgApiError);
    expect(err.statusCode).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// Authorization header
// ---------------------------------------------------------------------------
describe('authorization header', () => {
  it('includes Bearer token on every request', async () => {
    const mockFn = mockFetch([{ ok: true, status: 200, body: {} }]);
    vi.stubGlobal('fetch', mockFn);
    await makeClient().querySparql('SELECT * WHERE { ?s ?p ?o }');
    const [, init] = mockFn.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`);
  });

  it('strips trailing slash from daemonUrl', async () => {
    const mockFn = mockFetch([{ ok: true, status: 200 }]);
    vi.stubGlobal('fetch', mockFn);
    const client = new DkgWmClient({ daemonUrl: 'http://127.0.0.1:9200/', token: TOKEN });
    await client.getStatus();
    const [url] = mockFn.mock.calls[0] as [string];
    expect(url).not.toContain('//api');
  });
});

// ---------------------------------------------------------------------------
// Retry logic
// ---------------------------------------------------------------------------
describe('retry on DkgUnavailableError', () => {
  it('retries on 503 and succeeds on the third attempt', async () => {
    const mockFn = mockFetch([
      { ok: false, status: 503 },
      { ok: false, status: 503 },
      { ok: true, status: 200, body: {} },
    ]);
    vi.stubGlobal('fetch', mockFn);
    vi.stubGlobal('setTimeout', (fn: () => void) => { fn(); return 0 as unknown as ReturnType<typeof setTimeout>; });

    await expect(makeClient({ maxRetries: 3 }).createContextGraph('test')).resolves.toBeUndefined();
    expect(mockFn.mock.calls).toHaveLength(3);
  });

  it('throws DkgUnavailableError after exhausting all retries', async () => {
    vi.stubGlobal('fetch', mockFetch(Array.from({ length: 5 }, () => ({ ok: false, status: 503 }))));
    vi.stubGlobal('setTimeout', (fn: () => void) => { fn(); return 0 as unknown as ReturnType<typeof setTimeout>; });

    await expect(makeClient({ maxRetries: 2 }).createContextGraph('test')).rejects.toThrow(DkgUnavailableError);
  });

  it('does NOT retry on 4xx DkgApiError', async () => {
    const mockFn = mockFetch([{ ok: false, status: 404 }]);
    vi.stubGlobal('fetch', mockFn);
    await expect(makeClient().createContextGraph('test')).rejects.toThrow(DkgApiError);
    expect(mockFn.mock.calls).toHaveLength(1);
  });

  it('does NOT retry on DkgAuthError', async () => {
    const mockFn = mockFetch([{ ok: false, status: 401 }]);
    vi.stubGlobal('fetch', mockFn);
    await expect(makeClient({ maxRetries: 3 }).createContextGraph('test')).rejects.toThrow(DkgAuthError);
    expect(mockFn.mock.calls).toHaveLength(1);
  });

  it('logs retry info when logger is present', async () => {
    const infoFn = vi.fn();
    const client = makeClient({
      maxRetries: 2,
      logger: { info: infoFn, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    });
    vi.stubGlobal('fetch', mockFetch([
      { ok: false, status: 503 },
      { ok: true, status: 200 },
    ]));
    vi.stubGlobal('setTimeout', (fn: () => void) => { fn(); return 0 as unknown as ReturnType<typeof setTimeout>; });

    await client.createContextGraph('test');
    expect(infoFn).toHaveBeenCalledWith(expect.stringContaining('retry'));
  });
});
