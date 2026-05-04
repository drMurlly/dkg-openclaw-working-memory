import type { OpenClawTool } from '../types/openclaw.js';
import type { PluginConfig } from '../types/artifact.js';
import { ARTIFACT_STATUSES } from '../types/artifact.js';
import type { DkgWmClient } from '../modules/dkg-wm-client.js';
import { serializeStatusUpdateQuads } from '../modules/jsonld-serializer.js';

export function createStatusUpdateTool(options: {
  client: DkgWmClient;
  config: PluginConfig;
}): OpenClawTool {
  const { client, config } = options;

  return {
    name: 'update_artifact_status',
    description:
      'Change the status of a Working Memory artifact. ' +
      'Status progression: draft → review_needed → validated → ready_to_share. ' +
      'Use this to curate findings through the trust gradient.',
    parameters: {
      artifactId: {
        type: 'string',
        description: 'The artifact ID (urn:dkg:wm:...) to update.',
      },
      newStatus: {
        type: 'string',
        enum: ARTIFACT_STATUSES,
        description: 'The new status to assign.',
      },
    },

    async handler(args: Record<string, unknown>): Promise<unknown> {
      if (typeof args['artifactId'] !== 'string' || !args['artifactId']) {
        return { success: false, message: 'artifactId must be a non-empty string.' };
      }
      if (typeof args['newStatus'] !== 'string' || !ARTIFACT_STATUSES.includes(args['newStatus'] as never)) {
        return {
          success: false,
          message: `newStatus must be one of: ${ARTIFACT_STATUSES.join(', ')}.`,
        };
      }

      const artifactId = args['artifactId'];
      const newStatus = args['newStatus'];
      const modifiedAt = new Date().toISOString();
      const quads = serializeStatusUpdateQuads(artifactId, newStatus, modifiedAt);

      try {
        await client.writeAssertion(config.contextGraph, config.assertionName, quads);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, artifactId, newStatus, message: `Failed to update status: ${msg}` };
      }

      return {
        success: true,
        artifactId,
        newStatus,
        modifiedAt,
        message: `Artifact status updated to '${newStatus}'.`,
      };
    },
  };
}
