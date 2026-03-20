export type ProviderName = 'anthropic' | 'bedrock' | 'openai' | 'gemini' | 'vertex' | 'ollama';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  artifactIds?: string[];
  toolCalls?: ToolCallDisplay[];
  timestamp: string;
  rating?: 'like' | 'dislike';
}

export interface ToolCallDisplay {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
}

export interface Artifact {
  id: string;
  type: 'code' | 'markdown' | 'mermaid' | 'html' | 'image';
  title: string;
  content: string;
  language?: string;
}

export interface ConversationMeta {
  id: string;
  name: string;
  created: string;
  updated: string;
  messageCount: number;
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

export interface ServerStatus {
  name: string;
  status: 'connected' | 'error' | 'disconnected';
  tools: { name: string; description: string }[];
  error?: string;
}

export interface Settings {
  provider: ProviderName;
  model: string;
  theme: 'light' | 'dark' | 'system';
  apiKeys: Partial<Record<ProviderName, string>>;
}

export interface WorkflowStepStatus {
  nodeId: string;
  tool: string;
  args?: Record<string, unknown>;
  status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
  result?: string;
  error?: string;
  durationMs?: number;
}

export interface SSEEvent {
  event: string;
  data: Record<string, unknown>;
}
