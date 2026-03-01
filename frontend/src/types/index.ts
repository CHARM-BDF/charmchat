export type ProviderName = 'anthropic' | 'bedrock' | 'openai' | 'gemini' | 'ollama';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  artifactIds?: string[];
  toolCalls?: ToolCallDisplay[];
  timestamp: string;
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

export interface Conversation {
  id: string;
  name: string;
  created: string;
  updated: string;
  messages: Message[];
  artifacts: Artifact[];
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

export interface SSEEvent {
  event: string;
  data: Record<string, unknown>;
}
