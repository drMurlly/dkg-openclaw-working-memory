export interface OpenClawLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
}

export interface OpenClawToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  enum?: string[];
  optional?: boolean;
  default?: unknown;
  properties?: Record<string, OpenClawToolParameter>;
  items?: OpenClawToolParameter;
}

export interface OpenClawTool {
  name: string;
  description: string;
  parameters: Record<string, OpenClawToolParameter>;
  handler(args: Record<string, unknown>): Promise<unknown>;
}

export type OpenClawRegistrationMode =
  | 'full'
  | 'setup-runtime'
  | 'setup-only'
  | 'cli-metadata';

export interface AgentEndEvent {
  messageText?: string;
  sessionId?: string;
  conversationId?: string;
}

export interface BeforeCompactionEvent {
  contextSnapshot?: {
    messages?: Array<{ role: string; text: string }>;
  };
}

export type OpenClawEventMap = {
  agent_end: AgentEndEvent;
  before_compaction: BeforeCompactionEvent;
  before_prompt_build: Record<string, unknown>;
  before_reset: Record<string, unknown>;
};

export interface OpenClawRuntime {
  state: {
    resolveStateDir(workspaceDir: string): string;
  };
}

export interface OpenClawPluginConfig {
  [key: string]: unknown;
}

export interface OpenClawPluginApi {
  registrationMode: OpenClawRegistrationMode;
  workspaceDir: string;
  logger: OpenClawLogger;
  runtime: OpenClawRuntime;
  config: OpenClawPluginConfig;

  registerTool(tool: OpenClawTool): void;
  registerChannel(channel: unknown): void;
  registerHttpRoute(route: unknown): void;
  registerMemoryCapability(capability: unknown): void;
  registerMemoryPromptSection(section: unknown): void;

  on<K extends keyof OpenClawEventMap>(
    event: K,
    handler: (event: OpenClawEventMap[K]) => void | Promise<void>,
  ): void;
}
