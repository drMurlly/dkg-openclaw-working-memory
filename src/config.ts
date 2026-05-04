import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { PluginConfig } from './types/artifact.js';
import type { OpenClawPluginApi } from './types/openclaw.js';

const PLUGIN_KEY = 'dkg-openclaw-working-memory';

interface RawCaptureConfig {
  autoCapture?: boolean;
  chat?: boolean;
  files?: boolean;
  toolOutputs?: boolean;
  minContentLength?: number;
  skipPatterns?: string[];
}

interface RawDkgConfig {
  nodeUrl?: string;
  authTokenPath?: string;
}

interface RawPluginConfig {
  dkg?: RawDkgConfig;
  enabled?: boolean;
  contextGraph?: string;
  assertionName?: string;
  authorId?: string;
  agentId?: string;
  capture?: RawCaptureConfig;
  redaction?: { enabled?: boolean };
  dedupe?: { enabled?: boolean };
}

function readOpenClawConfig(): RawPluginConfig {
  try {
    const cfgPath = join(homedir(), '.openclaw', 'openclaw.json');
    const raw = JSON.parse(readFileSync(cfgPath, 'utf-8')) as Record<string, unknown>;
    const entries = raw?.plugins as Record<string, unknown> | undefined;
    const pluginEntries = entries?.entries as Record<string, unknown> | undefined;
    const pluginEntry = pluginEntries?.[PLUGIN_KEY] as Record<string, unknown> | undefined;
    return (pluginEntry?.config ?? {}) as RawPluginConfig;
  } catch {
    return {};
  }
}

export function loadConfig(api: OpenClawPluginApi): PluginConfig {
  const fileConfig = readOpenClawConfig();
  const apiConfig = (api.config ?? {}) as RawPluginConfig;
  const raw: RawPluginConfig = { ...fileConfig, ...apiConfig };

  const daemonUrl =
    process.env['DKG_DAEMON_URL'] ??
    raw.dkg?.nodeUrl ??
    'http://127.0.0.1:9200';

  const authTokenPath =
    raw.dkg?.authTokenPath ??
    '~/.dkg/auth.token';

  const contextGraph =
    process.env['DKG_WM_CONTEXT_GRAPH'] ??
    raw.contextGraph ??
    'wm-artifacts';

  const assertionName =
    process.env['DKG_WM_ASSERTION_NAME'] ??
    raw.assertionName ??
    'artifacts';

  const authorId =
    process.env['DKG_WM_AUTHOR_ID'] ??
    raw.authorId ??
    'unknown';

  const agentId =
    process.env['DKG_WM_AGENT_ID'] ??
    raw.agentId ??
    'openclaw-agent';

  const enabled =
    process.env['DKG_WM_CAPTURE_ENABLED'] === 'false'
      ? false
      : (raw.enabled ?? true);

  return {
    daemonUrl,
    authTokenPath,
    enabled,
    contextGraph,
    assertionName,
    authorId,
    agentId,
    capture: {
      autoCapture: raw.capture?.autoCapture ?? true,
      chat: raw.capture?.chat ?? true,
      files: raw.capture?.files ?? true,
      toolOutputs: raw.capture?.toolOutputs ?? true,
      minContentLength: raw.capture?.minContentLength ?? 120,
      skipPatterns: raw.capture?.skipPatterns ?? [],
    },
    redaction: { enabled: raw.redaction?.enabled ?? true },
    dedupe: { enabled: raw.dedupe?.enabled ?? true, strategy: 'contentHash' },
    stateDir: '',
  };
}

/**
 * Load the bearer token from env or token file.
 * Token files written by the DKG daemon may contain comment lines (# ...) — strip them.
 */
export function loadToken(config: PluginConfig): string {
  if (process.env['DKG_AUTH_TOKEN']) {
    return process.env['DKG_AUTH_TOKEN'];
  }
  const tokenPath = config.authTokenPath.replace(/^~/, homedir());
  try {
    const raw = readFileSync(tokenPath, 'utf-8');
    const token = raw
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'))
      .join('');
    if (!token) {
      throw new Error(`Token file at ${tokenPath} is empty or contains only comments.`);
    }
    return token;
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Token file')) throw err;
    throw new Error(
      `DKG auth token not found at ${tokenPath}. ` +
      'Set DKG_AUTH_TOKEN env var or ensure ~/.dkg/auth.token exists.',
    );
  }
}
