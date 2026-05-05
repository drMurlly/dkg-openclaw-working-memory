import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OpenClawPluginApi, OpenClawLogger } from './types/openclaw.js';
import type { RawCaptureInput } from './types/artifact.js';
import { DkgWmClient } from './modules/dkg-wm-client.js';
import { DedupeStore } from './modules/dedupe-store.js';
import { loadConfig, loadToken } from './config.js';
import { normalizeArtifact } from './modules/artifact-normalizer.js';
import { serializeToQuads } from './modules/jsonld-serializer.js';
import {
  createDepositTool,
  createPromoteTool,
  createStatusUpdateTool,
  createSearchTool,
} from './tools/index.js';

/** Extracts plain text from message content (string or block array). */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(b => b && typeof b === 'object' && 'type' in (b as object) && (b as {type: string}).type === 'text' && 'text' in (b as object))
      .map(b => (b as {text: string}).text)
      .join('\n');
  }
  return '';
}

interface AgentMessage {
  role?: string;
  content?: unknown;
  text?: string; // legacy field used in some test contexts
}

export class DkgOpenClawWorkingMemoryPlugin {
  private client!: DkgWmClient;
  private dedupe!: DedupeStore;
  private config!: ReturnType<typeof loadConfig>;
  private logger?: OpenClawLogger;

  // Arrow function field: OpenClaw extracts `plugin.register` and calls it without
  // a receiver, so we capture `this` lexically to avoid "Cannot set properties of
  // undefined" errors. OpenClaw also ignores the returned Promise when register is
  // async, so this is intentionally synchronous — async work is fired in background.
  register = (api: OpenClawPluginApi): void => {
    if (api.registrationMode !== 'full') return;

    this.logger = api.logger;
    this.config = loadConfig(api);

    if (!this.config.enabled) {
      api.logger.info('dkg-openclaw-working-memory: disabled by config');
      return;
    }

    const stateDir =
      api.runtime?.state?.resolveStateDir?.(api.workspaceDir) ??
      join(tmpdir(), 'dkg-openclaw-working-memory');

    this.config.stateDir = stateDir;

    this.dedupe = new DedupeStore({ stateDir });
    // Non-blocking: load persisted dedupe index from disk in background
    this.dedupe.load().catch((err: unknown) => {
      this.logger?.warn?.(
        `[dkg-wm] Failed to load dedupe store: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    let token: string;
    try {
      token = loadToken(this.config);
    } catch (err: unknown) {
      api.logger.error(
        `dkg-openclaw-working-memory: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    this.client = new DkgWmClient({
      daemonUrl: this.config.daemonUrl,
      token,
      logger: api.logger,
    });

    // Non-blocking: resolve agentAddress once so querySparql doesn't need extra round-trips
    this.client.getAgentAddress().catch(() => undefined);

    // Non-blocking: pre-create the context graph so the first write is faster
    this.client.ensureContextGraph(this.config.contextGraph, 'WM Artifacts').catch((err: unknown) => {
      this.logger?.warn?.(
        `[dkg-wm] Could not pre-create context graph on startup — ` +
        `${err instanceof Error ? err.message : String(err)}`,
      );
    });

    api.registerTool(
      createDepositTool({ client: this.client, dedupe: this.dedupe, config: this.config }),
    );
    api.registerTool(
      createPromoteTool({ client: this.client, config: this.config }),
    );
    api.registerTool(
      createStatusUpdateTool({ client: this.client, config: this.config }),
    );
    api.registerTool(
      createSearchTool({ client: this.client, config: this.config }),
    );

    if (this.config.capture.autoCapture) {
      api.on('agent_end', (event) => {
        this.handleAgentEnd(event as {
          messages?: AgentMessage[];
          success?: boolean;
        }).catch((err: unknown) => {
          this.logger?.warn?.(
            `[dkg-wm] agent_end capture error: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      });
      api.on('before_compaction', (event) => {
        this.handleBeforeCompaction(event as {
          messages?: AgentMessage[];
          messageCount?: number;
          tokenCount?: number;
        }).catch((err: unknown) => {
          this.logger?.warn?.(
            `[dkg-wm] before_compaction capture error: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      });
    }

    api.logger.info('dkg-openclaw-working-memory: plugin registered');
  };

  private async handleAgentEnd(event: {
    messages?: AgentMessage[];
    success?: boolean;
  }): Promise<void> {
    // Only capture successful turns
    if (event.success === false) return;
    const messages = Array.isArray(event.messages) ? event.messages : [];

    // Capture the last assistant message produced in this turn
    const assistantMsgs = messages.filter(m => m && m.role === 'assistant');
    const last = assistantMsgs[assistantMsgs.length - 1];
    if (!last) return;

    const text = extractText(last.content ?? last.text);
    if (!text || text.length < this.config.capture.minContentLength) return;

    await this.capture({
      content: text,
      source: 'chat',
      artifactType: 'chat',
    });
  }

  private async handleBeforeCompaction(event: {
    messages?: AgentMessage[];
    messageCount?: number;
    tokenCount?: number;
  }): Promise<void> {
    // before_compaction may be called without messages (metric-only variant)
    const messages = Array.isArray(event.messages) ? event.messages : [];

    for (const msg of messages) {
      if (!msg || typeof msg !== 'object') continue;
      if (msg.role !== 'assistant') continue;
      const text = extractText(msg.content ?? msg.text);
      if (!text || text.length < this.config.capture.minContentLength) continue;
      await this.capture({
        content: text,
        source: 'chat',
        artifactType: 'summary',
      });
    }
  }

  async capture(raw: RawCaptureInput): Promise<void> {
    // Guard: register() may have failed before client/dedupe were initialised
    if (!this.client || !this.dedupe || !this.config) return;

    const artifact = normalizeArtifact(raw, this.config);
    if (!artifact) return;

    if (this.config.dedupe.enabled && this.dedupe.has(artifact.contentHash)) return;

    const quads = serializeToQuads(artifact);

    try {
      const receipt = await this.client.createOrWriteAssertion({
        contextGraphId: this.config.contextGraph,
        name: this.config.assertionName,
        quads,
        assertionExists: this.dedupe.isAssertionCreated(),
      });

      if (!this.dedupe.isAssertionCreated()) {
        this.dedupe.markAssertionCreated();
      }

      artifact.dkg.ual = receipt.ual;
      this.dedupe.add(artifact.contentHash, receipt.ual);

      try {
        await this.dedupe.save();
      } catch {
        this.logger?.warn?.('[dkg-wm] Auto-capture: failed to persist dedupe index');
      }

      this.logger?.info?.(`[dkg-wm] Artifact captured — UAL: ${artifact.dkg.ual ?? 'pending'}`);
    } catch (err: unknown) {
      // log but don't throw — auto-capture failure must not disrupt the agent
      const msg = err instanceof Error ? err.message : String(err);
      this.logger?.warn?.(`[dkg-wm] Auto-capture failed: ${msg}`);
    }
  }
}

export default new DkgOpenClawWorkingMemoryPlugin();
