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

export class DkgOpenClawWorkingMemoryPlugin {
  private client!: DkgWmClient;
  private dedupe!: DedupeStore;
  private config!: ReturnType<typeof loadConfig>;
  private logger?: OpenClawLogger;

  async register(api: OpenClawPluginApi): Promise<void> {
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
    await this.dedupe.load();

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

    try {
      await this.client.ensureContextGraph(this.config.contextGraph, 'WM Artifacts');
    } catch (err: unknown) {
      api.logger.error(
        `dkg-openclaw-working-memory: could not connect to DKG node — ` +
        `${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

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
        this.handleAgentEnd(event as { messageText?: string; sessionId?: string; conversationId?: string })
          .catch(err => {
            this.logger?.warn?.(
              `[dkg-wm] agent_end capture error: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
      });
      api.on('before_compaction', (event) => {
        this.handleBeforeCompaction(event as { contextSnapshot?: { messages?: Array<{ role: string; text: string }> } })
          .catch(err => {
            this.logger?.warn?.(
              `[dkg-wm] before_compaction capture error: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
      });
    }

    api.logger.info('dkg-openclaw-working-memory: plugin registered');
  }

  private async handleAgentEnd(event: {
    messageText?: string;
    sessionId?: string;
    conversationId?: string;
  }): Promise<void> {
    if (!event.messageText) return;
    if (event.messageText.length < this.config.capture.minContentLength) return;

    await this.capture({
      content: event.messageText,
      source: 'chat',
      artifactType: 'chat',
      sessionId: event.sessionId,
      conversationId: event.conversationId,
    });
  }

  private async handleBeforeCompaction(event: {
    contextSnapshot?: { messages?: unknown };
  }): Promise<void> {
    const messages = Array.isArray(event.contextSnapshot?.messages)
      ? event.contextSnapshot.messages
      : [];
    for (const msg of messages) {
      if (!msg || typeof msg !== 'object') continue;
      const { role, text } = msg as Record<string, unknown>;
      if (role !== 'assistant') continue;
      if (typeof text !== 'string' || text.length < this.config.capture.minContentLength) continue;
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
    } catch (err: unknown) {
      // log but don't throw — auto-capture failure must not disrupt the agent
      const msg = err instanceof Error ? err.message : String(err);
      this.logger?.warn?.(`[dkg-wm] Auto-capture failed: ${msg}`);
    }
  }
}

export default new DkgOpenClawWorkingMemoryPlugin();
