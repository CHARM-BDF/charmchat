export type ProviderName = 'anthropic' | 'bedrock' | 'openai' | 'gemini' | 'vertex' | 'ollama';

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
  event: 'delta' | 'tool_call' | 'tool_result' | 'artifact' | 'trace_entry' | 'provenance' | 'done' | 'error';
  data: Record<string, unknown>;
}

export interface Artifact {
  id: string;
  type: string;
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
  rating?: 'like' | 'dislike';
  provenanceReport?: ProvenanceReport;
  counterReport?: CounterReport;
  challengeToolCalls?: { name: string; args: Record<string, unknown>; result?: unknown }[];
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
  parameters: { name: string; description: string; example?: string }[];
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
  hasDisliked: boolean;
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

// Provenance / taint-key types

export interface EvidenceEntry {
  key: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  content: string;
  isEmpty: boolean;
  timestamp: string;
}

export interface ClaimEvidence {
  claim: string;
  evidenceKey: string;
  excerpt: string;
  sourceIds?: string[];
  keyValid: boolean;
  excerptVerified: boolean;
}

export interface ProvenanceReport {
  evidenceStore: Record<string, EvidenceEntry>;
  claims: ClaimEvidence[];
  uncitedKeys: string[];
  hasEvidence: boolean;
}

// Picrophant / counter-report types

export type ClaimVerdict = 'contradicted' | 'weakened' | 'stands';

export interface CounterClaim {
  claim: string;
  verdict: ClaimVerdict;
  unverifiable: boolean;       // could not be grounded/checked at all — orthogonal to verdict
  rationale: string;
  evidenceKeys: string[];      // taint keys of the anti-evidence supporting this verdict
}

// An inferential dependency between two claims (claims are the nodes; the report's
// argument is a DAG over them). `from` supplies evidence used to infer `to`; the
// inferential MOVE is where "weakened"-style weaknesses live, so it carries its own
// licensed/unwarranted status independent of either claim's truth verdict.
export interface CounterEdge {
  from: number;            // source claim index (0-based into counterClaims)
  to: number;              // target claim index
  move: string;            // the type of inferential leap ("serum→central", "n=1→recommendation", …)
  licensed: boolean;       // does the evidence actually warrant the move?
  rationale: string;
  evidenceKeys: string[];  // anti-evidence that the move fails (taint keys)
}

export interface CounterReport {
  counterClaims: CounterClaim[];
  edges?: CounterEdge[];         // inferential structure over the claims (optional)
  provenance: ProvenanceReport;  // verified anti-evidence gathered by the sub-agent
}
