import type { OpenClawTool } from '../types/openclaw.js';
import type { PluginConfig } from '../types/artifact.js';
import { ARTIFACT_STATUSES, ARTIFACT_TYPES } from '../types/artifact.js';
import type { DkgWmClient } from '../modules/dkg-wm-client.js';

interface SearchArgs {
  query: string;
  status?: string;
  type?: string;
  limit?: number;
}

function buildSparqlQuery(args: SearchArgs, assertionName: string): string {
  const limit = args.limit ?? 10;

  const filters: string[] = [];

  if (args.status) {
    filters.push(`FILTER(?status = "${args.status}")`);
  }
  if (args.type) {
    filters.push(`FILTER(?type = "${args.type}")`);
  }
  if (args.query) {
    const escaped = args.query.replace(/"/g, '\\"');
    filters.push(
      `FILTER(CONTAINS(LCASE(STR(?content)), LCASE("${escaped}")) || ` +
      `CONTAINS(LCASE(STR(?name)), LCASE("${escaped}")))`
    );
  }

  const filterBlock = filters.length > 0 ? filters.join('\n  ') : '';

  return `
PREFIX wm: <https://ontology.origintrail.io/dkg/wm#>
PREFIX schema: <https://schema.org/>

SELECT ?id ?name ?type ?status ?contentHash ?capturedAt WHERE {
  GRAPH <${assertionName}> {
    ?id a wm:WorkingMemoryArtifact ;
        wm:status ?status ;
        wm:artifactType ?type ;
        wm:contentHash ?contentHash ;
        schema:name ?name ;
        wm:provenance [ wm:capturedAt ?capturedAt ] .
    OPTIONAL { ?id schema:text ?content }
    ${filterBlock}
  }
}
ORDER BY DESC(?capturedAt)
LIMIT ${limit}
`.trim();
}

export function createSearchTool(options: {
  client: DkgWmClient;
  config: PluginConfig;
}): OpenClawTool {
  const { client, config } = options;

  return {
    name: 'search_working_memory',
    description:
      'Search past artifacts in Working Memory by keyword, type, or status. ' +
      'Use this at the start of a session to recall prior research, findings, or plans.',
    parameters: {
      query: {
        type: 'string',
        description: 'Natural language search query (matched against content and title).',
      },
      status: {
        type: 'string',
        enum: ARTIFACT_STATUSES,
        optional: true,
        description: 'Filter by artifact status.',
      },
      type: {
        type: 'string',
        enum: ARTIFACT_TYPES,
        optional: true,
        description: 'Filter by artifact type.',
      },
      limit: {
        type: 'number',
        optional: true,
        default: 10,
        description: 'Maximum number of results to return.',
      },
    },

    async handler(args: Record<string, unknown>): Promise<unknown> {
      const a = args as unknown as SearchArgs;
      const sparql = buildSparqlQuery(a, config.assertionName);

      const results = await client.querySparql(sparql);

      return {
        success: true,
        query: a.query,
        results,
        message: 'Working Memory search complete.',
      };
    },
  };
}
