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

/**
 * Escape a value for safe interpolation inside a SPARQL double-quoted string literal.
 * Covers all escape sequences defined by SPARQL 1.1 §19.8.
 */
function escapeSparqlString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

function buildSparqlQuery(args: SearchArgs, assertionName: string): string {
  const limit = Math.min(Math.max(1, Math.floor(args.limit ?? 10)), 100);

  const filters: string[] = [];

  if (args.status && ARTIFACT_STATUSES.includes(args.status as never)) {
    filters.push(`FILTER(?status = "${escapeSparqlString(args.status)}")`);
  }
  if (args.type && ARTIFACT_TYPES.includes(args.type as never)) {
    filters.push(`FILTER(?type = "${escapeSparqlString(args.type)}")`);
  }
  if (args.query) {
    const escaped = escapeSparqlString(args.query);
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
        description: 'Maximum number of results to return (1–100).',
      },
    },

    async handler(args: Record<string, unknown>): Promise<unknown> {
      const query = typeof args['query'] === 'string' ? args['query'] : '';
      const status = typeof args['status'] === 'string' ? args['status'] : undefined;
      const type = typeof args['type'] === 'string' ? args['type'] : undefined;
      const limit = typeof args['limit'] === 'number' ? args['limit'] : 10;

      const a: SearchArgs = { query, status, type, limit };
      const sparql = buildSparqlQuery(a, config.assertionName);

      const results = await client.querySparql(sparql, {
        contextGraphId: config.contextGraph,
        view: 'working-memory',
      });

      return {
        success: true,
        query,
        results,
        message: 'Working Memory search complete.',
      };
    },
  };
}
