import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, loadToken } from '../src/config.js';
import type { OpenClawPluginApi } from '../src/types/openclaw.js';
import type { PluginConfig } from '../src/types/artifact.js';

function makeApi(config: Record<string, unknown> = {}): OpenClawPluginApi {
  return {
    registrationMode: 'full',
    workspaceDir: '/tmp',
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    runtime: null as unknown as OpenClawPluginApi['runtime'],
    config,
    registerTool: vi.fn(),
    registerChannel: vi.fn(),
    registerHttpRoute: vi.fn(),
    registerMemoryCapability: vi.fn(),
    registerMemoryPromptSection: vi.fn(),
    on: vi.fn(),
  } as unknown as OpenClawPluginApi;
}

function makeTokenConfig(authTokenPath: string): PluginConfig {
  return {
    daemonUrl: 'http://127.0.0.1:9200',
    authTokenPath,
    enabled: true,
    contextGraph: 'wm-artifacts',
    assertionName: 'artifacts',
    authorId: 'test',
    agentId: 'test-agent',
    capture: { autoCapture: true, chat: true, files: true, toolOutputs: true, minContentLength: 50, skipPatterns: [] },
    redaction: { enabled: true },
    dedupe: { enabled: true, strategy: 'contentHash' },
    stateDir: '',
  };
}

describe('loadConfig', () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it('returns sensible defaults when no env vars or config file', () => {
    const cfg = loadConfig(makeApi());
    expect(cfg.daemonUrl).toBe('http://127.0.0.1:9200');
    expect(cfg.authTokenPath).toBe('~/.dkg/auth.token');
    expect(cfg.contextGraph).toBe('wm-artifacts');
    expect(cfg.assertionName).toBe('artifacts');
    expect(cfg.authorId).toBe('unknown');
    expect(cfg.agentId).toBe('openclaw-agent');
    expect(cfg.enabled).toBe(true);
    expect(cfg.capture.autoCapture).toBe(true);
    expect(cfg.capture.minContentLength).toBe(120);
    expect(cfg.redaction.enabled).toBe(true);
    expect(cfg.dedupe.enabled).toBe(true);
    expect(cfg.dedupe.strategy).toBe('contentHash');
  });

  it('DKG_DAEMON_URL overrides daemonUrl', () => {
    vi.stubEnv('DKG_DAEMON_URL', 'http://10.0.0.2:9200');
    expect(loadConfig(makeApi()).daemonUrl).toBe('http://10.0.0.2:9200');
  });

  it('DKG_WM_CONTEXT_GRAPH overrides contextGraph', () => {
    vi.stubEnv('DKG_WM_CONTEXT_GRAPH', 'custom-cg');
    expect(loadConfig(makeApi()).contextGraph).toBe('custom-cg');
  });

  it('DKG_WM_ASSERTION_NAME overrides assertionName', () => {
    vi.stubEnv('DKG_WM_ASSERTION_NAME', 'custom-assert');
    expect(loadConfig(makeApi()).assertionName).toBe('custom-assert');
  });

  it('DKG_WM_AUTHOR_ID overrides authorId', () => {
    vi.stubEnv('DKG_WM_AUTHOR_ID', 'alice');
    expect(loadConfig(makeApi()).authorId).toBe('alice');
  });

  it('DKG_WM_AGENT_ID overrides agentId', () => {
    vi.stubEnv('DKG_WM_AGENT_ID', 'my-bot');
    expect(loadConfig(makeApi()).agentId).toBe('my-bot');
  });

  it('DKG_WM_CAPTURE_ENABLED=false disables plugin', () => {
    vi.stubEnv('DKG_WM_CAPTURE_ENABLED', 'false');
    expect(loadConfig(makeApi()).enabled).toBe(false);
  });

  it('DKG_WM_CAPTURE_ENABLED=true keeps plugin enabled', () => {
    vi.stubEnv('DKG_WM_CAPTURE_ENABLED', 'true');
    expect(loadConfig(makeApi()).enabled).toBe(true);
  });

  it('api.config contextGraph and authorId override defaults', () => {
    const cfg = loadConfig(makeApi({ contextGraph: 'api-cg', authorId: 'bob' }));
    expect(cfg.contextGraph).toBe('api-cg');
    expect(cfg.authorId).toBe('bob');
  });

  it('api.config capture settings are merged', () => {
    const cfg = loadConfig(makeApi({ capture: { autoCapture: false, minContentLength: 250 } }));
    expect(cfg.capture.autoCapture).toBe(false);
    expect(cfg.capture.minContentLength).toBe(250);
    // Unset keys fall back to defaults
    expect(cfg.capture.chat).toBe(true);
  });

  it('api.config redaction.enabled=false disables redaction', () => {
    const cfg = loadConfig(makeApi({ redaction: { enabled: false } }));
    expect(cfg.redaction.enabled).toBe(false);
  });

  it('api.config dedupe.enabled=false disables dedup', () => {
    const cfg = loadConfig(makeApi({ dedupe: { enabled: false } }));
    expect(cfg.dedupe.enabled).toBe(false);
  });

  it('api.config dkg.nodeUrl overrides daemonUrl', () => {
    const cfg = loadConfig(makeApi({ dkg: { nodeUrl: 'http://192.168.1.1:9200' } }));
    expect(cfg.daemonUrl).toBe('http://192.168.1.1:9200');
  });

  it('api.config dkg.authTokenPath overrides authTokenPath', () => {
    const cfg = loadConfig(makeApi({ dkg: { authTokenPath: '/custom/token' } }));
    expect(cfg.authTokenPath).toBe('/custom/token');
  });

  it('stateDir starts empty (set later by plugin)', () => {
    expect(loadConfig(makeApi()).stateDir).toBe('');
  });
});

describe('loadToken', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'token-test-'));
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
    vi.unstubAllEnvs();
  });

  it('reads token from DKG_AUTH_TOKEN env var (highest priority)', () => {
    vi.stubEnv('DKG_AUTH_TOKEN', 'env-bearer-xyz');
    expect(loadToken(makeTokenConfig('/nonexistent'))).toBe('env-bearer-xyz');
  });

  it('reads plain token from file', () => {
    const tokenFile = join(tempDir, 'auth.token');
    writeFileSync(tokenFile, 'plain-token-abc\n');
    expect(loadToken(makeTokenConfig(tokenFile))).toBe('plain-token-abc');
  });

  it('strips # comment lines from token file', () => {
    const tokenFile = join(tempDir, 'auth.token');
    writeFileSync(tokenFile, '# DKG node API token — treat this like a password\nactual-token-xyz\n');
    expect(loadToken(makeTokenConfig(tokenFile))).toBe('actual-token-xyz');
  });

  it('strips multiple comment lines and blank lines', () => {
    const tokenFile = join(tempDir, 'auth.token');
    writeFileSync(tokenFile, '# comment1\n# comment2\n\nmy-real-token\n# trailing\n');
    expect(loadToken(makeTokenConfig(tokenFile))).toBe('my-real-token');
  });

  it('expands ~ to homedir in token path', () => {
    // Write token to a path under homedir, then reference with ~
    const subDir = join(homedir(), '.dkg-test-token-' + Date.now());
    try {
      mkdirSync(subDir, { recursive: true });
      const tokenFile = join(subDir, 'auth.token');
      writeFileSync(tokenFile, 'tilde-expanded-token\n');
      const tildePath = tokenFile.replace(homedir(), '~');
      if (tildePath.startsWith('~')) {
        expect(loadToken(makeTokenConfig(tildePath))).toBe('tilde-expanded-token');
      }
    } finally {
      rmSync(subDir, { recursive: true, force: true });
    }
  });

  it('throws descriptive error when token file is missing', () => {
    expect(() => loadToken(makeTokenConfig(join(tempDir, 'no-such-token'))))
      .toThrow('DKG auth token not found');
  });

  it('throws when token file contains only whitespace', () => {
    const tokenFile = join(tempDir, 'empty.token');
    writeFileSync(tokenFile, '   \n\t\n');
    expect(() => loadToken(makeTokenConfig(tokenFile))).toThrow();
  });

  it('throws when token file contains only comments', () => {
    const tokenFile = join(tempDir, 'comments.token');
    writeFileSync(tokenFile, '# comment1\n# comment2\n');
    expect(() => loadToken(makeTokenConfig(tokenFile))).toThrow('empty or contains only comments');
  });
});
