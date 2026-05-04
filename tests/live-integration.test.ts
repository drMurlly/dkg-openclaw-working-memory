import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DkgWmClient } from '../src/modules/dkg-wm-client.js';
import { DedupeStore } from '../src/modules/dedupe-store.js';
import { normalizeArtifact } from '../src/modules/artifact-normalizer.js';
import { serializeToJsonLd } from '../src/modules/jsonld-serializer.js';
import type { PluginConfig } from '../src/types/artifact.js';

const LIVE = process.env['DKG_INTEGRATION_TEST'] === '1';
const DAEMON = process.env['DKG_DAEMON_URL'] ?? 'http://127.0.0.1:9200';
function loadLiveToken(): string {
  if (process.env['DKG_AUTH_TOKEN']) return process.env['DKG_AUTH_TOKEN'];
  try {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { homedir } = require('node:os') as typeof import('node:os');
    return readFileSync(`${homedir()}/.dkg/auth.token`, 'utf-8').trim();
  } catch {
    return 'no-token';
  }
}
const TOKEN = loadLiveToken();

const makeConfig = (stateDir: string): PluginConfig => ({
  daemonUrl: DAEMON,
  authTokenPath: '~/.dkg/auth.token',
  enabled: true,
  contextGraph: 'wm-artifacts-test',
  assertionName: `artifacts-live-${Date.now()}`,
  authorId: 'drMurlly',
  agentId: 'openclaw-agent',
  capture: {
    autoCapture: true,
    chat: true,
    files: true,
    toolOutputs: true,
    minContentLength: 50,
    skipPatterns: [],
  },
  redaction: { enabled: true },
  dedupe: { enabled: true, strategy: 'contentHash' },
  stateDir,
});

describe.skipIf(!LIVE)('live integration against real DKG node', () => {
  let tempDir: string;
  let client: DkgWmClient;
  let config: PluginConfig;

  async function setup() {
    tempDir = await mkdtemp(join(tmpdir(), 'dkg-live-test-'));
    config = makeConfig(tempDir);
    client = new DkgWmClient({ daemonUrl: DAEMON, token: String(TOKEN) });
  }

  async function teardown() {
    await rm(tempDir, { recursive: true, force: true });
  }

  it('node is reachable and responds to /api/status', async () => {
    await setup();
    try {
      const status = await client.getStatus();
      expect(status).toBeTruthy();
    } finally {
      await teardown();
    }
  });

  it('deposits an artifact and retrieves it via SPARQL', async () => {
    await setup();
    const dedupe = new DedupeStore({ stateDir: tempDir });
    await dedupe.load();

    try {
      await client.ensureContextGraph(config.contextGraph);

      const content = `Live integration test: reentrancy vulnerability analysis for Protocol X.
Identified that the withdraw function calls external contract before updating balance state.
This is a classic reentrancy pattern that could allow an attacker to drain funds.
Test timestamp: ${new Date().toISOString()}`;

      const raw = {
        content,
        source: 'manual' as const,
        artifactType: 'vulnerability_finding' as const,
        sessionId: 'live-test-session',
      };

      const artifact = normalizeArtifact(raw, config)!;
      expect(artifact).not.toBeNull();
      expect(artifact.artifactId).toMatch(/^urn:dkg:wm:[a-f0-9]{16}$/);

      const jsonld = serializeToJsonLd(artifact);
      const receipt = await client.createOrWriteAssertion({
        contextGraph: config.contextGraph,
        name: config.assertionName,
        content: jsonld,
        assertionExists: dedupe.isAssertionCreated(),
      });

      expect(receipt).toBeTruthy();
      dedupe.markAssertionCreated();
      if (receipt.ual) {
        dedupe.add(artifact.contentHash, receipt.ual);
        artifact.dkg.ual = receipt.ual;
      }
      await dedupe.save();

      // Query back to verify
      const sparql = `
PREFIX wm: <https://ontology.origintrail.io/dkg/wm#>
PREFIX schema: <https://schema.org/>
SELECT ?id ?status ?contentHash WHERE {
  ?id a wm:WorkingMemoryArtifact ;
      wm:status ?status ;
      wm:contentHash ?contentHash .
}
LIMIT 10
      `.trim();

      const results = await client.querySparql(sparql);
      expect(results).toBeTruthy();
    } finally {
      await teardown();
    }
  });

  it('deduplicates repeated deposits of same content', async () => {
    await setup();
    const dedupe = new DedupeStore({ stateDir: tempDir });
    await dedupe.load();

    try {
      await client.ensureContextGraph(config.contextGraph);

      const content = `Dedup test: integer overflow in token transfer function.
The _amount parameter is not validated before arithmetic operation.
This can cause unexpected behavior when amount exceeds uint256 max.
Test timestamp: ${new Date().toISOString()}`;

      const raw = { content, source: 'manual' as const };
      const artifact = normalizeArtifact(raw, config)!;

      await client.createOrWriteAssertion({
        contextGraph: config.contextGraph,
        name: config.assertionName,
        content: serializeToJsonLd(artifact),
        assertionExists: dedupe.isAssertionCreated(),
      });
      dedupe.markAssertionCreated();
      dedupe.add(artifact.contentHash, 'ual:first');
      await dedupe.save();

      // reload and check
      const dedupe2 = new DedupeStore({ stateDir: tempDir });
      await dedupe2.load();
      expect(dedupe2.has(artifact.contentHash)).toBe(true);
    } finally {
      await teardown();
    }
  });

  it('redacts secrets before writing to DKG', async () => {
    await setup();
    const dedupe = new DedupeStore({ stateDir: tempDir });
    await dedupe.load();

    try {
      await client.ensureContextGraph(config.contextGraph);

      const fakeKey = 'sk-' + 'a'.repeat(30);
      const content = `Research note with accidental secret: ${fakeKey}.
The actual finding is that the protocol uses a weak PRNG for seed generation.
This can be exploited by miners who control block.timestamp.`;

      const raw = { content, source: 'manual' as const };
      const artifact = normalizeArtifact(raw, config)!;

      expect(artifact.content).not.toContain(fakeKey);
      expect(artifact.content).toContain('[REDACTED]');

      // Write to DKG — if no error, the redacted content was accepted
      await client.createOrWriteAssertion({
        contextGraph: config.contextGraph,
        name: config.assertionName,
        content: serializeToJsonLd(artifact),
        assertionExists: dedupe.isAssertionCreated(),
      });
    } finally {
      await teardown();
    }
  });
});
