import type { OpenClawTool } from '../types/openclaw.js';
import type { PluginConfig, RawCaptureInput } from '../types/artifact.js';
import { ARTIFACT_TYPES, ARTIFACT_STATUSES } from '../types/artifact.js';
import type { DkgWmClient } from '../modules/dkg-wm-client.js';
import type { DedupeStore } from '../modules/dedupe-store.js';
import { normalizeArtifact } from '../modules/artifact-normalizer.js';
import { serializeToQuads } from '../modules/jsonld-serializer.js';

const MAX_CONTENT_LENGTH = 500_000;

interface DepositArgs {
  content: string;
  artifactType: string;
  status?: string;
  title?: string;
  sessionId?: string;
}

export function createDepositTool(options: {
  client: DkgWmClient;
  dedupe: DedupeStore;
  config: PluginConfig;
}): OpenClawTool {
  const { client, dedupe, config } = options;

  return {
    name: 'deposit_artifact_to_working_memory',
    description:
      'Deposit a text artifact into DKG V10 Working Memory with a status tag and provenance. ' +
      'Use this to explicitly save any research note, vulnerability finding, plan, or analysis ' +
      'so it persists across sessions.',
    parameters: {
      content: {
        type: 'string',
        description: 'The full text content to deposit into Working Memory.',
      },
      artifactType: {
        type: 'string',
        enum: ARTIFACT_TYPES,
        description: 'The artifact type.',
      },
      status: {
        type: 'string',
        enum: ARTIFACT_STATUSES,
        optional: true,
        description: 'Override the auto-classified status.',
      },
      title: {
        type: 'string',
        optional: true,
        description: 'Short title for the artifact (auto-generated if omitted).',
      },
      sessionId: {
        type: 'string',
        optional: true,
        description: 'Current session identifier for provenance.',
      },
    },

    async handler(args: Record<string, unknown>): Promise<unknown> {
      if (!config.enabled) {
        return { success: false, message: 'Plugin is disabled in config.' };
      }

      // Explicit type validation before use
      if (typeof args['content'] !== 'string') {
        return { success: false, message: 'content must be a string.' };
      }
      if (typeof args['artifactType'] !== 'string') {
        return { success: false, message: 'artifactType must be a string.' };
      }

      const a: DepositArgs = {
        content: args['content'],
        artifactType: args['artifactType'],
        status: typeof args['status'] === 'string' ? args['status'] : undefined,
        title: typeof args['title'] === 'string' ? args['title'] : undefined,
        sessionId: typeof args['sessionId'] === 'string' ? args['sessionId'] : undefined,
      };

      if (a.content.length > MAX_CONTENT_LENGTH) {
        return {
          success: false,
          message: `Content exceeds maximum allowed size of ${MAX_CONTENT_LENGTH} characters.`,
        };
      }

      const artifact = normalizeArtifact(
        {
          content: a.content,
          source: 'manual',
          artifactType: ARTIFACT_TYPES.includes(a.artifactType as never)
            ? (a.artifactType as RawCaptureInput['artifactType'])
            : undefined,
          title: a.title,
          status: ARTIFACT_STATUSES.includes(a.status as never)
            ? (a.status as RawCaptureInput['status'])
            : undefined,
          sessionId: a.sessionId,
        },
        config,
      );

      if (!artifact) {
        return {
          success: false,
          message: `Content too short (minimum ${config.capture.minContentLength} characters).`,
        };
      }

      if (config.dedupe.enabled && dedupe.has(artifact.contentHash)) {
        const existing = dedupe.getRecord(artifact.contentHash);
        return {
          success: true,
          deduplicated: true,
          artifactId: artifact.artifactId,
          ual: existing?.ual,
          status: artifact.status,
          message: 'Artifact already exists in Working Memory (content-hash match).',
        };
      }

      const quads = serializeToQuads(artifact);
      const receipt = await client.createOrWriteAssertion({
        contextGraphId: config.contextGraph,
        name: config.assertionName,
        quads,
        assertionExists: dedupe.isAssertionCreated(),
      });

      if (!dedupe.isAssertionCreated()) {
        dedupe.markAssertionCreated();
      }

      artifact.dkg.ual = receipt.ual;
      dedupe.add(artifact.contentHash, receipt.ual);

      // Persist dedup index; non-fatal if it fails (artifact is already stored)
      try {
        await dedupe.save();
      } catch {
        client.logger?.warn?.('[dkg-wm] Failed to persist dedupe index — next session may re-deposit this artifact');
      }

      return {
        success: true,
        artifactId: artifact.artifactId,
        ual: receipt.ual ?? null,
        status: artifact.status,
        contextGraph: config.contextGraph,
        assertionName: config.assertionName,
        message: `Artifact deposited into Working Memory. Status: ${artifact.status}.`,
      };
    },
  };
}
