import type { OpenClawTool } from '../types/openclaw.js';
import type { PluginConfig } from '../types/artifact.js';
import type { DkgWmClient } from '../modules/dkg-wm-client.js';

interface PromoteArgs {
  artifactId: string;
  confirm: boolean;
}

export function createPromoteTool(options: {
  client: DkgWmClient;
  config: PluginConfig;
}): OpenClawTool {
  const { client, config } = options;

  return {
    name: 'promote_artifact_to_shared_memory',
    description:
      'Promote a Working Memory artifact to Shared Working Memory so team peers can see it. ' +
      'This operation gossip-replicates the artifact to peer nodes. ' +
      'ONLY call this after the user has explicitly confirmed they want to share the artifact.',
    parameters: {
      artifactId: {
        type: 'string',
        description: 'The artifact ID (urn:dkg:wm:...) to promote.',
      },
      confirm: {
        type: 'boolean',
        description: 'Must be true — user must explicitly confirm sharing before calling this tool.',
      },
    },

    async handler(args: Record<string, unknown>): Promise<unknown> {
      const a = args as unknown as PromoteArgs;

      if (!a.confirm) {
        return {
          success: false,
          message:
            'Promotion aborted. Set confirm=true only after the user explicitly confirms they want to share this artifact.',
        };
      }

      await client.promoteAssertion(config.assertionName);

      return {
        success: true,
        artifactId: a.artifactId,
        assertionName: config.assertionName,
        message:
          `Artifact promoted to Shared Working Memory. ` +
          `The assertion '${config.assertionName}' is now gossip-replicated to team peers.`,
      };
    },
  };
}
