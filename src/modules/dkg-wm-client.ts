import type { OpenClawLogger } from '../types/openclaw.js';

export class DkgAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DkgAuthError';
  }
}

export class DkgUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DkgUnavailableError';
  }
}

export class DkgApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'DkgApiError';
  }
}

/** RDF quad in N-Quads-compatible JSON format — the format the DKG v10 daemon accepts. */
export interface RdfQuad {
  subject: string;
  predicate: string;
  /** URI (no quotes) or N-Quads literal e.g. `"some string"` */
  object: string;
  graph?: string;
}

interface DkgWmClientOptions {
  daemonUrl: string;
  token: string;
  timeoutMs?: number;
  maxRetries?: number;
  logger?: OpenClawLogger;
}

interface CreateAssertionReceipt {
  assertionUri?: string;
  ual?: string;
  alreadyExists?: boolean;
}

interface WriteReceipt {
  written?: number;
  ual?: string;
}

export class DkgWmClient {
  private readonly daemonUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  readonly logger?: OpenClawLogger;

  constructor(options: DkgWmClientOptions) {
    this.daemonUrl = options.daemonUrl.replace(/\/$/, '');
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.logger = options.logger;
  }

  private headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.daemonUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        method,
        headers: this.headers(),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (res.status === 401) {
        throw new DkgAuthError(`DKG auth failed (401). Check your bearer token.`);
      }
      if (res.status === 503 || res.status === 502) {
        throw new DkgUnavailableError(`DKG node unavailable (${res.status}). Is the node running?`);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new DkgApiError(`DKG API error ${res.status}: ${text}`, res.status);
      }

      const text = await res.text();
      if (!text) return {} as T;
      return JSON.parse(text) as T;
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof DkgAuthError || err instanceof DkgUnavailableError || err instanceof DkgApiError) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed') || msg.includes('abort')) {
        throw new DkgUnavailableError(`DKG node unreachable at ${this.daemonUrl}: ${msg}`);
      }
      throw err;
    }
  }

  /**
   * Wraps request() with exponential-backoff retry for transient node unavailability.
   * Auth errors and API errors (4xx) are never retried.
   */
  private async requestWithRetry<T>(method: string, path: string, body?: unknown): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.request<T>(method, path, body);
      } catch (err: unknown) {
        if (!(err instanceof DkgUnavailableError) || attempt === this.maxRetries) throw err;
        lastErr = err;
        const delayMs = (2 ** attempt) * 250;
        this.logger?.info?.(`[dkg-wm] Node unavailable, retrying in ${delayMs}ms (attempt ${attempt + 1}/${this.maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    throw lastErr;
  }

  // ---------------------------------------------------------------------------
  // Context Graph
  // ---------------------------------------------------------------------------

  async createContextGraph(id: string, name: string, description?: string): Promise<void> {
    await this.requestWithRetry<unknown>('POST', '/api/context-graph/create', { id, name, description });
    this.logger?.info?.(`[dkg-wm] Context Graph '${id}' created`);
  }

  /**
   * Create context graph, swallowing "already exists" 400/409 errors so calls are idempotent.
   */
  async ensureContextGraph(id: string, name?: string): Promise<void> {
    try {
      await this.createContextGraph(id, name ?? id);
    } catch (err: unknown) {
      if (err instanceof DkgApiError && (err.statusCode === 400 || err.statusCode === 409)) {
        const msg = err.message.toLowerCase();
        if (msg.includes('already exists') || msg.includes('already registered')) return;
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Assertion lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Create an empty assertion inside a context graph.
   * Returns the assertion URI. If the assertion already exists, returns { alreadyExists: true }.
   */
  async createAssertion(contextGraphId: string, name: string): Promise<CreateAssertionReceipt> {
    try {
      const receipt = await this.requestWithRetry<CreateAssertionReceipt>('POST', '/api/assertion/create', {
        contextGraphId,
        name,
      });
      this.logger?.info?.(`[dkg-wm] Assertion '${name}' created — URI: ${receipt.assertionUri ?? 'none'}`);
      return receipt;
    } catch (err: unknown) {
      if (err instanceof DkgApiError && (err.statusCode === 400 || err.statusCode === 409)) {
        const msg = err.message.toLowerCase();
        if (msg.includes('already exists')) {
          return { alreadyExists: true };
        }
      }
      throw err;
    }
  }

  /**
   * Write RDF quads into an existing assertion.
   * Quads must be in the format: { subject: URI, predicate: URI, object: URI or "literal" }
   */
  async writeAssertion(contextGraphId: string, name: string, quads: RdfQuad[]): Promise<WriteReceipt> {
    const receipt = await this.requestWithRetry<WriteReceipt>('POST', `/api/assertion/${encodeURIComponent(name)}/write`, {
      contextGraphId,
      quads,
    });
    this.logger?.info?.(`[dkg-wm] Wrote ${quads.length} quads to '${name}'`);
    return receipt;
  }

  /**
   * Create assertion + write quads in one logical operation.
   * If assertionExists=true, skips the create step and only writes.
   */
  async createOrWriteAssertion(params: {
    contextGraphId: string;
    name: string;
    quads: RdfQuad[];
    assertionExists: boolean;
  }): Promise<{ ual?: string; alreadyExists?: boolean }> {
    if (!params.assertionExists) {
      const receipt = await this.createAssertion(params.contextGraphId, params.name);
      if (!receipt.alreadyExists) {
        await this.writeAssertion(params.contextGraphId, params.name, params.quads);
        return { ual: receipt.assertionUri };
      }
    }
    await this.writeAssertion(params.contextGraphId, params.name, params.quads);
    return {};
  }

  /**
   * Dump all quads from an assertion graph.
   */
  async queryAssertion(contextGraphId: string, name: string): Promise<{ quads: RdfQuad[]; count: number }> {
    return this.requestWithRetry('POST', `/api/assertion/${encodeURIComponent(name)}/query`, {
      contextGraphId,
    });
  }

  async getAssertionHistory(contextGraphId: string, name: string): Promise<unknown> {
    const params = new URLSearchParams({ contextGraphId });
    return this.requestWithRetry<unknown>('GET', `/api/assertion/${encodeURIComponent(name)}/history?${params.toString()}`);
  }

  async promoteAssertion(contextGraphId: string, name: string): Promise<void> {
    await this.requestWithRetry<unknown>('POST', `/api/assertion/${encodeURIComponent(name)}/promote`, {
      contextGraphId,
    });
    this.logger?.info?.(`[dkg-wm] Assertion '${name}' promoted to Shared Working Memory`);
  }

  // ---------------------------------------------------------------------------
  // SPARQL
  // ---------------------------------------------------------------------------

  /**
   * Run a SPARQL SELECT query scoped to working-memory of a context graph.
   */
  async querySparql(
    sparql: string,
    opts?: {
      contextGraphId?: string;
      view?: 'working-memory' | 'shared-working-memory' | 'verified-memory';
      assertionName?: string;
    },
  ): Promise<unknown> {
    return this.requestWithRetry<unknown>('POST', '/api/query', {
      sparql,
      view: opts?.view ?? 'working-memory',
      contextGraphId: opts?.contextGraphId,
      assertionName: opts?.assertionName,
    });
  }

  // ---------------------------------------------------------------------------
  // Health
  // ---------------------------------------------------------------------------

  async getStatus(): Promise<unknown> {
    return this.requestWithRetry<unknown>('GET', '/api/status');
  }
}
