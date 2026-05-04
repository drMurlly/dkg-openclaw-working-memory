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

interface DkgWmClientOptions {
  daemonUrl: string;
  token: string;
  timeoutMs?: number;
  logger?: OpenClawLogger;
}

interface WriteReceipt {
  ual?: string;
}

export class DkgWmClient {
  private readonly daemonUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly logger?: OpenClawLogger;

  constructor(options: DkgWmClientOptions) {
    this.daemonUrl = options.daemonUrl.replace(/\/$/, '');
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 30_000;
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

  async contextGraphExists(name: string): Promise<boolean> {
    try {
      await this.request<unknown>('GET', `/api/context-graph/exists?name=${encodeURIComponent(name)}`);
      return true;
    } catch (err: unknown) {
      if (err instanceof DkgApiError && err.statusCode === 404) return false;
      throw err;
    }
  }

  async createContextGraph(name: string): Promise<void> {
    await this.request<unknown>('POST', '/api/context-graph/create', { name });
    this.logger?.info(`[dkg-wm] Context Graph '${name}' created`);
  }

  async ensureContextGraph(name: string): Promise<void> {
    const exists = await this.contextGraphExists(name);
    if (!exists) {
      await this.createContextGraph(name);
    }
  }

  async createAssertion(params: {
    contextGraph: string;
    name: string;
    content: unknown;
  }): Promise<WriteReceipt> {
    const receipt = await this.request<WriteReceipt>('POST', '/api/assertion/create', {
      contextGraph: params.contextGraph,
      name: params.name,
      content: params.content,
    });
    this.logger?.info(`[dkg-wm] Assertion '${params.name}' created — UAL: ${receipt.ual ?? 'none'}`);
    return receipt;
  }

  async writeAssertion(name: string, content: unknown): Promise<WriteReceipt> {
    const receipt = await this.request<WriteReceipt>('POST', `/api/assertion/${encodeURIComponent(name)}/write`, {
      content,
    });
    this.logger?.info(`[dkg-wm] Artifact written to '${name}' — UAL: ${receipt.ual ?? 'none'}`);
    return receipt;
  }

  async createOrWriteAssertion(params: {
    contextGraph: string;
    name: string;
    content: unknown;
    assertionExists: boolean;
  }): Promise<WriteReceipt> {
    if (!params.assertionExists) {
      return this.createAssertion({
        contextGraph: params.contextGraph,
        name: params.name,
        content: params.content,
      });
    }
    return this.writeAssertion(params.name, params.content);
  }

  async queryAssertion(name: string, sparql: string): Promise<unknown> {
    return this.request<unknown>('POST', `/api/assertion/${encodeURIComponent(name)}/query`, {
      query: sparql,
    });
  }

  async getAssertionHistory(name: string): Promise<unknown> {
    return this.request<unknown>('GET', `/api/assertion/${encodeURIComponent(name)}/history`);
  }

  async promoteAssertion(name: string): Promise<void> {
    await this.request<unknown>('POST', `/api/assertion/${encodeURIComponent(name)}/promote`);
    this.logger?.info(`[dkg-wm] Assertion '${name}' promoted to Shared Working Memory`);
  }

  async querySparql(sparql: string): Promise<unknown> {
    return this.request<unknown>('POST', '/api/query', { query: sparql });
  }

  async getStatus(): Promise<unknown> {
    return this.request<unknown>('GET', '/api/status');
  }
}
