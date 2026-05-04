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
  describe('ensureContextGraph', () => {
    it('creates CG via single idempotent POST', async () => {
      vi.stubGlobal('fetch', mockFetch([
        { ok: true, status: 200, body: {} },
      ]));
      const client = makeClient();
      await client.ensureContextGraph('wm-artifacts');
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    });

    it('swallows 409 "already exists" error', async () => {
      vi.stubGlobal('fetch', mockFetch([
        { ok: false, status: 409, body: { error: 'context graph already exists' } },
      ]));
      const client = makeClient();
      await expect(client.ensureContextGraph('wm-artifacts')).resolves.toBeUndefined();
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    });
  });

  describe('createAssertion', () => {
    it('calls POST /api/assertion/create with correct body', async () => {
      const mockFn = mockFetch([{ ok: true, status: 200, body: { assertionUri: 'ual:test:abc' } }]);
      vi.stubGlobal('fetch', mockFn);
      const client = makeClient();

      const receipt = await client.createAssertion('wm-artifacts', 'artifacts');

      expect(receipt.assertionUri).toBe('ual:test:abc');
      const [url, init] = mockFn.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/api/assertion/create');
      expect(init.method).toBe('POST');
    });
  });

  describe('writeAssertion', () => {
    it('calls POST /api/assertion/{name}/write', async () => {
      const mockFn = mockFetch([{ ok: true, status: 200, body: { written: 1 } }]);
      vi.stubGlobal('fetch', mockFn);
      const client = makeClient();

      await client.writeAssertion('wm-artifacts', 'artifacts', [
        { subject: 'urn:test', predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type', object: 'urn:test:Type' },
      ]);

      const [url] = mockFn.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/api/assertion/artifacts/write');
    });
  });

  describe('createOrWriteAssertion', () => {
    it('calls create then write when assertionExists=false', async () => {
      const mockFn = mockFetch([
        { ok: true, status: 200, body: { assertionUri: 'ual:create:abc' } },
        { ok: true, status: 200, body: { written: 1 } },
      ]);
      vi.stubGlobal('fetch', mockFn);
      const client = makeClient();

      await client.createOrWriteAssertion({
        contextGraphId: 'wm-artifacts',
        name: 'artifacts',
        quads: [{ subject: 'urn:s', predicate: 'urn:p', object: '"o"' }],
        assertionExists: false,
      });

      const [firstUrl] = mockFn.mock.calls[0] as [string, RequestInit];
      expect(firstUrl).toContain('/api/assertion/create');
      expect(mockFn.mock.calls).toHaveLength(2);
    });

    it('calls only write when assertionExists=true', async () => {
      const mockFn = mockFetch([{ ok: true, status: 200, body: { written: 1 } }]);
      vi.stubGlobal('fetch', mockFn);
      const client = makeClient();

      await client.createOrWriteAssertion({
        contextGraphId: 'wm-artifacts',
        name: 'artifacts',
        quads: [{ subject: 'urn:s', predicate: 'urn:p', object: '"o"' }],
        assertionExists: true,
      });

      const [url] = mockFn.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/api/assertion/artifacts/write');
      expect(mockFn.mock.calls).toHaveLength(1);
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
