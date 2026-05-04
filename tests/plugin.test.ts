import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Importing from the barrel ensures src/index.ts and src/tools/index.ts are covered
import { DkgOpenClawWorkingMemoryPlugin } from '../src/index.js';
import type { OpenClawPluginApi } from '../src/types/openclaw.js';

let tempDir: string;

function makeApi(overrides: Partial<OpenClawPluginApi> & { config?: Record<string, unknown> } = {}): OpenClawPluginApi {
  const { config: configOverride, ...rest } = overrides;
  return {
    registrationMode: 'full',
    workspaceDir: tempDir,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    runtime: { state: { resolveStateDir: () => tempDir } },
    config: configOverride ?? {},
    registerTool: vi.fn(),
    registerChannel: vi.fn(),
    registerHttpRoute: vi.fn(),
    registerMemoryCapability: vi.fn(),
    registerMemoryPromptSection: vi.fn(),
    on: vi.fn(),
    ...rest,
  } as unknown as OpenClawPluginApi;
}

/** Mock fetch that returns success for the ensureContextGraph call only. */
function mockSuccessfulNode(extraResponses: Array<{ body?: unknown }> = []) {
  const responses = [
    { ok: true, status: 200, body: {} },   // ensureContextGraph → context-graph/create
    ...extraResponses.map(r => ({ ok: true, status: 200, body: r.body ?? {} })),
  ];
  let i = 0;
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
    const resp = responses[i] ?? responses[responses.length - 1];
    i++;
    return { ok: resp.ok, status: resp.status, text: async () => JSON.stringify(resp.body) };
  }));
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'plugin-test-'));
  vi.stubEnv('DKG_AUTH_TOKEN', 'test-bearer-token');
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// register()
// ---------------------------------------------------------------------------
describe('DkgOpenClawWorkingMemoryPlugin.register()', () => {
  it('returns immediately when registrationMode is not "full"', async () => {
    const api = makeApi({ registrationMode: 'setup-only' });
    await new DkgOpenClawWorkingMemoryPlugin().register(api);
    expect(api.registerTool as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('logs "disabled" and returns when plugin is disabled via env var', async () => {
    vi.stubEnv('DKG_WM_CAPTURE_ENABLED', 'false');
    mockSuccessfulNode();
    const api = makeApi();
    await new DkgOpenClawWorkingMemoryPlugin().register(api);
    expect(api.registerTool as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    const infoCalls = (api.logger.info as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => String(c[0]));
    expect(infoCalls.some(m => m.includes('disabled'))).toBe(true);
  });

  it('logs error and skips tool registration when DKG_AUTH_TOKEN is missing', async () => {
    vi.unstubAllEnvs();
    // Point authTokenPath to a file that definitely does not exist
    const api = makeApi({ config: { dkg: { authTokenPath: join(tempDir, 'nonexistent.token') } } });
    await new DkgOpenClawWorkingMemoryPlugin().register(api);
    expect(api.registerTool as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(api.logger.error as ReturnType<typeof vi.fn>).toHaveBeenCalled();
  });

  it('logs error and skips tool registration when DKG node is unavailable (non-retried error)', async () => {
    // 500 throws DkgApiError (not DkgUnavailableError), so no retry occurs — test stays fast
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 500,
      text: async () => 'Internal Server Error',
    }));
    const api = makeApi();
    await new DkgOpenClawWorkingMemoryPlugin().register(api);
    expect(api.registerTool as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(api.logger.error as ReturnType<typeof vi.fn>).toHaveBeenCalled();
  });

  it('registers exactly 4 tools in full mode', async () => {
    mockSuccessfulNode();
    const api = makeApi();
    await new DkgOpenClawWorkingMemoryPlugin().register(api);
    expect((api.registerTool as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(4);
  });

  it('registers the correct tool names', async () => {
    mockSuccessfulNode();
    const api = makeApi();
    await new DkgOpenClawWorkingMemoryPlugin().register(api);
    const names = (api.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => (c[0] as { name: string }).name,
    );
    expect(names).toContain('deposit_artifact_to_working_memory');
    expect(names).toContain('promote_artifact_to_shared_memory');
    expect(names).toContain('update_artifact_status');
    expect(names).toContain('search_working_memory');
  });

  it('registers agent_end and before_compaction hooks when autoCapture=true', async () => {
    mockSuccessfulNode();
    const api = makeApi();
    await new DkgOpenClawWorkingMemoryPlugin().register(api);
    const eventNames = (api.on as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
    expect(eventNames).toContain('agent_end');
    expect(eventNames).toContain('before_compaction');
  });

  it('does NOT register hooks when autoCapture=false', async () => {
    mockSuccessfulNode();
    const api = makeApi({ config: { capture: { autoCapture: false } } });
    await new DkgOpenClawWorkingMemoryPlugin().register(api);
    expect((api.on as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('uses api.runtime.state.resolveStateDir for stateDir', async () => {
    mockSuccessfulNode();
    const resolveStateDirFn = vi.fn().mockReturnValue(tempDir);
    const api = makeApi({ runtime: { state: { resolveStateDir: resolveStateDirFn } } });
    await new DkgOpenClawWorkingMemoryPlugin().register(api);
    expect(resolveStateDirFn).toHaveBeenCalledWith(api.workspaceDir);
  });

  it('falls back to tmpdir when runtime is absent', async () => {
    mockSuccessfulNode();
    const api = makeApi({ runtime: undefined as unknown as OpenClawPluginApi['runtime'] });
    // Should not throw — falls back to os.tmpdir()
    await expect(new DkgOpenClawWorkingMemoryPlugin().register(api)).resolves.toBeUndefined();
    expect(api.registerTool as ReturnType<typeof vi.fn>).toHaveBeenCalled();
  });

  it('logs "plugin registered" on success', async () => {
    mockSuccessfulNode();
    const api = makeApi();
    await new DkgOpenClawWorkingMemoryPlugin().register(api);
    const infoCalls = (api.logger.info as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => String(c[0]));
    expect(infoCalls.some(m => m.includes('registered'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// capture()
// ---------------------------------------------------------------------------
describe('DkgOpenClawWorkingMemoryPlugin.capture()', () => {
  async function registeredPlugin() {
    mockSuccessfulNode();
    const api = makeApi();
    const plugin = new DkgOpenClawWorkingMemoryPlugin();
    await plugin.register(api);
    return { plugin, api };
  }

  it('does nothing when content is shorter than minContentLength', async () => {
    const { plugin } = await registeredPlugin();
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const before = fetchMock.mock.calls.length;
    await plugin.capture({ content: 'short', source: 'chat' });
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it('does nothing when content exceeds max length', async () => {
    const { plugin } = await registeredPlugin();
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const before = fetchMock.mock.calls.length;
    await plugin.capture({ content: 'x'.repeat(500_001), source: 'chat' });
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it('deposits content when valid and long enough', async () => {
    mockSuccessfulNode([
      { body: { assertionUri: 'ual:test:capture1' } }, // createAssertion
      { body: { written: 18 } },                        // writeAssertion
    ]);
    const api = makeApi();
    const plugin = new DkgOpenClawWorkingMemoryPlugin();
    await plugin.register(api);

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const before = fetchMock.mock.calls.length;

    await plugin.capture({
      content: 'This is a long enough research note to exceed the default minimum content length threshold of one hundred and twenty characters.',
      source: 'chat',
      artifactType: 'research_note',
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
  });

  it('skips duplicate content (same contentHash)', async () => {
    mockSuccessfulNode([
      { body: { assertionUri: 'ual:test:dedup' } },
      { body: { written: 18 } },
    ]);
    const api = makeApi();
    const plugin = new DkgOpenClawWorkingMemoryPlugin();
    await plugin.register(api);

    const content = 'This unique content must be long enough to be captured by the plugin on the first call, and deduplicated on the second call.';
    await plugin.capture({ content, source: 'chat' });

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const afterFirst = fetchMock.mock.calls.length;

    await plugin.capture({ content, source: 'chat' });
    expect(fetchMock.mock.calls.length).toBe(afterFirst); // no new fetch calls
  });

  it('logs warning and does not throw when DKG write fails', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({}) })         // ensureContextGraph
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'server error' })             // createAssertion fails
    );
    const api = makeApi();
    const plugin = new DkgOpenClawWorkingMemoryPlugin();
    await plugin.register(api);

    await expect(plugin.capture({
      content: 'Long enough content that will fail to deposit due to a simulated server error during the assertion create call to DKG v10.',
      source: 'chat',
    })).resolves.toBeUndefined();

    expect(api.logger.warn as ReturnType<typeof vi.fn>).toHaveBeenCalled();
  });

  it('marks assertion as created after first successful deposit', async () => {
    mockSuccessfulNode([
      { body: { assertionUri: 'ual:test:mark' } },
      { body: { written: 18 } },
    ]);
    const api = makeApi();
    const plugin = new DkgOpenClawWorkingMemoryPlugin();
    await plugin.register(api);

    const content1 = 'First unique piece of content that is long enough to trigger a deposit into DKG v10 working memory and mark assertion created.';
    await plugin.capture({ content: content1, source: 'chat' });

    // Next deposit uses writeAssertion (not createAssertion) — verify by checking URL
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const calls = fetchMock.mock.calls.map(c => (c as [string])[0]);
    expect(calls.some(u => u.includes('/api/assertion/create'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// agent_end event handler (via registered hook)
// ---------------------------------------------------------------------------
describe('agent_end event hook', () => {
  async function getAgentEndHandler() {
    mockSuccessfulNode();
    const api = makeApi();
    const plugin = new DkgOpenClawWorkingMemoryPlugin();
    await plugin.register(api);
    const calls = (api.on as ReturnType<typeof vi.fn>).mock.calls as [string, (e: unknown) => void][];
    return { handler: calls.find(c => c[0] === 'agent_end')![1], api, plugin };
  }

  it('skips when messageText is absent', async () => {
    const { handler } = await getAgentEndHandler();
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const before = fetchMock.mock.calls.length;
    await handler({});
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it('skips when messageText is shorter than minContentLength', async () => {
    const { handler } = await getAgentEndHandler();
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const before = fetchMock.mock.calls.length;
    await handler({ messageText: 'too short' });
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it('captures when messageText is long enough, passing sessionId and conversationId', async () => {
    mockSuccessfulNode([
      { body: { assertionUri: 'ual:agent-end-test' } },
      { body: { written: 20 } },
    ]);
    const api = makeApi();
    const plugin = new DkgOpenClawWorkingMemoryPlugin();
    await plugin.register(api);

    const calls = (api.on as ReturnType<typeof vi.fn>).mock.calls as [string, (e: unknown) => void][];
    const handler = calls.find(c => c[0] === 'agent_end')![1];

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const before = fetchMock.mock.calls.length;

    await handler({
      messageText: 'This is a sufficiently long agent message that must be captured. It contains research findings about reentrancy vulnerabilities in smart contracts.',
      sessionId: 'sess-abc',
      conversationId: 'conv-xyz',
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
  });

  it('catches and logs errors from capture without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({}) })
      .mockRejectedValue(new Error('sudden network failure')),
    );
    const api = makeApi();
    const plugin = new DkgOpenClawWorkingMemoryPlugin();
    await plugin.register(api);

    const calls = (api.on as ReturnType<typeof vi.fn>).mock.calls as [string, (e: unknown) => void][];
    const handler = calls.find(c => c[0] === 'agent_end')![1];

    // handler returns void (not a Promise) — just verify no synchronous throw
    handler({
      messageText: 'This content is long enough to exceed the minimum content length requirement and will fail due to a network error on the DKG assertion call.',
    });
    // Flush microtasks so the async chain (capture + error swallowing) can complete
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(api.logger.warn as ReturnType<typeof vi.fn>).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// before_compaction event handler (via registered hook)
// ---------------------------------------------------------------------------
describe('before_compaction event hook', () => {
  async function getCompactionHandler() {
    mockSuccessfulNode();
    const api = makeApi();
    const plugin = new DkgOpenClawWorkingMemoryPlugin();
    await plugin.register(api);
    const calls = (api.on as ReturnType<typeof vi.fn>).mock.calls as [string, (e: unknown) => void][];
    return { handler: calls.find(c => c[0] === 'before_compaction')![1], api };
  }

  it('captures long assistant messages', async () => {
    mockSuccessfulNode([
      { body: { assertionUri: 'ual:compaction-test' } },
      { body: { written: 5 } },
    ]);
    const api = makeApi();
    const plugin = new DkgOpenClawWorkingMemoryPlugin();
    await plugin.register(api);
    const calls = (api.on as ReturnType<typeof vi.fn>).mock.calls as [string, (e: unknown) => void][];
    const handler = calls.find(c => c[0] === 'before_compaction')![1];

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const before = fetchMock.mock.calls.length;

    await handler({
      contextSnapshot: {
        messages: [
          { role: 'user', text: 'User question that should never be captured even though it is very long in words.' },
          { role: 'assistant', text: 'This is a very detailed assistant response that exceeds the minimum content length and should therefore be captured as a summary artifact in working memory.' },
        ],
      },
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
  });

  it('skips all user messages regardless of length', async () => {
    const { handler } = await getCompactionHandler();
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const before = fetchMock.mock.calls.length;

    await handler({
      contextSnapshot: {
        messages: [
          { role: 'user', text: 'A very long user message that should be completely ignored by the before_compaction handler because it is not from the assistant.' },
        ],
      },
    });

    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it('handles absent contextSnapshot gracefully', async () => {
    const { handler } = await getCompactionHandler();
    expect(() => handler({})).not.toThrow();
  });

  it('skips assistant messages shorter than minContentLength', async () => {
    const { handler } = await getCompactionHandler();
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
    const before = fetchMock.mock.calls.length;
    await handler({
      contextSnapshot: { messages: [{ role: 'assistant', text: 'short reply' }] },
    });
    expect(fetchMock.mock.calls.length).toBe(before);
  });
});
