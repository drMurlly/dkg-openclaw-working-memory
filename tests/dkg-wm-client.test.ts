import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DkgWmClient, DkgAuthError, DkgUnavailableError } from '../src/modules/dkg-wm-client.js';

const DAEMON = 'http://127.0.0.1:9200';
const TOKEN = 'test-bearer-token';

function makeClient(): DkgWmClient {
  return new DkgWmClient({ daemonUrl: DAEMON, token: TOKEN });
}

function mockFetch(responses: Array<{ ok: boolean; status: number; body?: unknown }>) {
  let callIndex = 0;
  return vi.fn().mockImplementation(async () => {
    const resp = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    const body = JSON.stringify(resp.body ?? {});
    return {
      ok: resp.ok,
      status: resp.status,
      text: async () => body,
    };
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('dkg-wm-client', () => {
  describe('contextGraphExists', () => {
    it('returns true on 200', async () => {
      vi.stubGlobal('fetch', mockFetch([{ ok: true, status: 200, body: { exists: true } }]));
      const client = makeClient();
      expect(await client.contextGraphExists('wm-artifacts')).toBe(true);
    });

    it('returns false on 404', async () => {
      vi.stubGlobal('fetch', mockFetch([{ ok: false, status: 404 }]));
      const client = makeClient();
      expect(await client.contextGraphExists('wm-artifacts')).toBe(false);
    });
  });

  describe('ensureContextGraph', () => {
    it('creates CG when it does not exist', async () => {
      vi.stubGlobal('fetch', mockFetch([
        { ok: false, status: 404 },
        { ok: true, status: 200, body: {} },
      ]));
      const client = makeClient();
      await client.ensureContextGraph('wm-artifacts');
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    });

    it('skips create when CG already exists', async () => {
      vi.stubGlobal('fetch', mockFetch([
        { ok: true, status: 200, body: { exists: true } },
      ]));
      const client = makeClient();
      await client.ensureContextGraph('wm-artifacts');
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    });
  });

  describe('createAssertion', () => {
    it('calls POST /api/assertion/create with correct body', async () => {
      const mockFn = mockFetch([{ ok: true, status: 200, body: { ual: 'ual:test:abc' } }]);
      vi.stubGlobal('fetch', mockFn);
      const client = makeClient();

      const receipt = await client.createAssertion({
        contextGraph: 'wm-artifacts',
        name: 'artifacts',
        content: { '@type': 'wm:WorkingMemoryArtifact' },
      });

      expect(receipt.ual).toBe('ual:test:abc');
      const [url, init] = mockFn.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/api/assertion/create');
      expect(init.method).toBe('POST');
    });
  });

  describe('writeAssertion', () => {
    it('calls POST /api/assertion/{name}/write', async () => {
      const mockFn = mockFetch([{ ok: true, status: 200, body: { ual: 'ual:test:xyz' } }]);
      vi.stubGlobal('fetch', mockFn);
      const client = makeClient();

      const receipt = await client.writeAssertion('artifacts', { '@type': 'wm:WorkingMemoryArtifact' });

      expect(receipt.ual).toBe('ual:test:xyz');
      const [url] = mockFn.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/api/assertion/artifacts/write');
    });
  });

  describe('createOrWriteAssertion', () => {
    it('uses createAssertion when assertionExists=false', async () => {
      const mockFn = mockFetch([{ ok: true, status: 200, body: { ual: 'ual:create:abc' } }]);
      vi.stubGlobal('fetch', mockFn);
      const client = makeClient();

      await client.createOrWriteAssertion({
        contextGraph: 'wm-artifacts',
        name: 'artifacts',
        content: {},
        assertionExists: false,
      });

      const [url] = mockFn.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/api/assertion/create');
    });

    it('uses writeAssertion when assertionExists=true', async () => {
      const mockFn = mockFetch([{ ok: true, status: 200, body: { ual: 'ual:write:abc' } }]);
      vi.stubGlobal('fetch', mockFn);
      const client = makeClient();

      await client.createOrWriteAssertion({
        contextGraph: 'wm-artifacts',
        name: 'artifacts',
        content: {},
        assertionExists: true,
      });

      const [url] = mockFn.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/api/assertion/artifacts/write');
    });
  });

  describe('error handling', () => {
    it('throws DkgAuthError on 401', async () => {
      vi.stubGlobal('fetch', mockFetch([{ ok: false, status: 401 }]));
      const client = makeClient();
      await expect(client.createContextGraph('test')).rejects.toThrow(DkgAuthError);
    });

    it('throws DkgUnavailableError on 503', async () => {
      vi.stubGlobal('fetch', mockFetch([{ ok: false, status: 503 }]));
      const client = makeClient();
      await expect(client.createContextGraph('test')).rejects.toThrow(DkgUnavailableError);
    });

    it('throws DkgUnavailableError on connection refused', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
      const client = makeClient();
      await expect(client.createContextGraph('test')).rejects.toThrow(DkgUnavailableError);
    });
  });

  describe('authorization header', () => {
    it('includes Bearer token on every request', async () => {
      const mockFn = mockFetch([{ ok: true, status: 200, body: {} }]);
      vi.stubGlobal('fetch', mockFn);
      const client = makeClient();
      await client.querySparql('SELECT * WHERE { ?s ?p ?o }');
      const [, init] = mockFn.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe(`Bearer ${TOKEN}`);
    });
  });
});
