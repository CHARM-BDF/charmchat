export type ProviderName = 'anthropic' | 'bedrock' | 'openai' | 'gemini' | 'vertex' | 'ollama';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  artifactIds?: string[];
  toolCalls?: ToolCallDisplay[];
  timestamp: string;
  rating?: 'like' | 'dislike';
  provenanceReport?: ProvenanceReport;
}

export interface ToolCallDisplay {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
}

export interface Artifact {
  id: string;
  type: string;
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
  hasDisliked: boolean;
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
  unverifiable: boolean;
  rationale: string;
  evidenceKeys: string[];
}

export interface CounterReport {
  counterClaims: CounterClaim[];
  provenance: ProvenanceReport;
}
