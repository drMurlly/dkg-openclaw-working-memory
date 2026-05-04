import type { OpenClawTool } from '../types/openclaw.js';
import type { PluginConfig } from '../types/artifact.js';
import { ARTIFACT_STATUSES } from '../types/artifact.js';
import type { DkgWmClient } from '../modules/dkg-wm-client.js';
import { serializeStatusUpdateQuads } from '../modules/jsonld-serializer.js';

interface StatusUpdateArgs {
  artifactId: string;
  newStatus: string;
}

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
      const a = args as unknown as StatusUpdateArgs;

      const modifiedAt = new Date().toISOString();
      const quads = serializeStatusUpdateQuads(a.artifactId, a.newStatus, modifiedAt);

      await client.writeAssertion(config.contextGraph, config.assertionName, quads);

      return {
        success: true,
        artifactId: a.artifactId,
        newStatus: a.newStatus,
        modifiedAt,
        message: `Artifact status updated to '${a.newStatus}'.`,
      };
    },
  };
}
