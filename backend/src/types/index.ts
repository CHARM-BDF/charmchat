export type ProviderName = 'anthropic' | 'bedrock' | 'openai' | 'gemini' | 'ollama';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface StreamEvent {
  type: 'delta' | 'tool_call' | 'done' | 'error';
  content?: string;
  toolCall?: ToolCall;
  usage?: { promptTokens: number; completionTokens: number };
  error?: string;
}

export interface SSEEvent {
  event: 'delta' | 'tool_call' | 'tool_result' | 'artifact' | 'trace_entry' | 'done' | 'error';
  data: Record<string, unknown>;
}

export interface Artifact {
  id: string;
  type: 'code' | 'markdown' | 'mermaid' | 'html' | 'image';
  title: string;
  content: string;
  language?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  artifactIds?: string[];
  toolCalls?: { name: string; args: Record<string, unknown>; result?: unknown }[];
  timestamp: string;
}

export interface ToolTraceEntry {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  timestamp: string;
  durationMs: number;
}

export interface Conversation {
  id: string;
  name: string;
  created: string;
  updated: string;
  messages: Message[];
  artifacts: Artifact[];
  toolTrace?: ToolTraceEntry[];
}

export interface WorkflowNode {
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  parameters: { name: string; description: string }[];
  nodes: WorkflowNode[];
  enabled?: boolean;
  createdFrom?: string;
  created: string;
  updated: string;
}

export interface WorkflowMeta {
  id: string;
  name: string;
  description: string;
  nodeCount: number;
  enabled: boolean;
  created: string;
  updated: string;
}

export interface NodeExecution {
  nodeId: string;
  tool: string;
  resolvedArgs: Record<string, unknown>;
  argSources: Record<string, string>;
  output: unknown;
  timestamp: string;
  durationMs: number;
  status: 'success' | 'error';
  error?: string;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  workflowName: string;
  parameters: Record<string, unknown>;
  nodeExecutions: NodeExecution[];
  startedAt: string;
  completedAt: string;
  status: 'success' | 'partial' | 'error';
}

export interface ConversationMeta {
  id: string;
  name: string;
  created: string;
  updated: string;
  messageCount: number;
}

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  type?: 'remote';
  transport?: 'sse' | 'websocket';
  url?: string;
  timeout?: number;
}

export interface McpServersConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export interface ServerStatus {
  name: string;
  status: 'connected' | 'error' | 'disconnected';
  tools: ToolDefinition[];
  error?: string;
}

export interface Settings {
  provider: ProviderName;
  model: string;
  theme: 'light' | 'dark' | 'system';
  apiKeys: Partial<Record<ProviderName, string>>;
  blockedServers?: string[];
  blockedTools?: string[];
}

export interface LLMProvider {
  stream(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    options?: { model?: string; temperature?: number; maxTokens?: number }
  ): AsyncIterable<StreamEvent>;
}
