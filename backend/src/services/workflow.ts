import { v4 as uuidv4 } from 'uuid';
import type {
  SSEEvent,
  Workflow,
  WorkflowNode,
  NodeExecution,
  WorkflowExecution,
  ProviderName,
  ToolTraceEntry,
} from '../types/index.js';
import { MCPService } from './mcp.js';
import { StorageService } from './storage.js';
import { LLMService } from './llm/index.js';

const EXTRACT_PROMPT = `You are a workflow extraction assistant. Analyze the following tool call trace from a conversation and produce a parameterized workflow JSON.

The workflow should:
1. Identify each tool call as a node
2. Detect data dependencies between nodes (where one tool's output feeds into another's args)
3. Replace concrete input values that should be parameterized with { "$ref": "$input.paramName" }
4. Replace values that come from previous node outputs with { "$ref": "nodeId.path.to.value" }
5. Give the workflow a descriptive name and description

Tool trace:
\`\`\`json
{{TRACE}}
\`\`\`

Respond with ONLY a JSON object in this exact format (no explanation):
\`\`\`json
{
  "name": "descriptive workflow name",
  "description": "what this workflow does",
  "parameters": [{ "name": "paramName", "description": "what this parameter is" }],
  "nodes": [
    {
      "id": "step1",
      "tool": "tool__name",
      "args": { "key": "value or { \\"$ref\\": \\"$input.paramName\\" } or { \\"$ref\\": \\"step1.path\\" }" }
    }
  ]
}
\`\`\``;

export class WorkflowService {
  private mcpService: MCPService;
  private storage: StorageService;
  private llmService: LLMService;

  constructor(mcpService: MCPService, storage: StorageService, llmService: LLMService) {
    this.mcpService = mcpService;
    this.storage = storage;
    this.llmService = llmService;
  }

  async extractWorkflow(
    conversationId: string,
    provider: ProviderName,
    apiKey?: string,
    model?: string
  ): Promise<Workflow> {
    const conversation = this.storage.loadConversation(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }
    if (!conversation.toolTrace || conversation.toolTrace.length === 0) {
      throw new Error('Conversation has no tool trace entries');
    }

    const prompt = EXTRACT_PROMPT.replace('{{TRACE}}', JSON.stringify(conversation.toolTrace, null, 2));
    const llmProvider = this.llmService.createProvider(provider, apiKey);

    let fullResponse = '';
    for await (const event of llmProvider.stream(
      [{ role: 'user', content: prompt }],
      undefined,
      { model }
    )) {
      if (event.type === 'delta' && event.content) {
        fullResponse += event.content;
      }
    }

    const parsed = extractJSON(fullResponse) as {
      name?: string;
      description?: string;
      parameters?: { name: string; description: string }[];
      nodes?: WorkflowNode[];
    } | null;
    if (!parsed || !parsed.name || !parsed.nodes) {
      throw new Error('Failed to parse workflow from LLM response');
    }

    const now = new Date().toISOString();
    const workflow: Workflow = {
      id: uuidv4(),
      name: parsed.name,
      description: parsed.description || '',
      parameters: parsed.parameters || [],
      nodes: parsed.nodes,
      createdFrom: conversationId,
      created: now,
      updated: now,
    };

    this.storage.saveWorkflow(workflow);
    return workflow;
  }

  async *execute(
    workflowId: string,
    parameters: Record<string, unknown>
  ): AsyncGenerator<SSEEvent> {
    const workflow = this.storage.loadWorkflow(workflowId);
    if (!workflow) {
      yield { event: 'error', data: { error: 'Workflow not found' } };
      return;
    }

    const deps = buildDependencyMap(workflow.nodes);
    const sorted = topologicalSort(workflow.nodes, deps);

    const outputs = new Map<string, unknown>();
    // Seed with input parameters
    outputs.set('$input', parameters);

    const nodeExecutions: NodeExecution[] = [];
    const startedAt = new Date().toISOString();
    let overallStatus: WorkflowExecution['status'] = 'success';

    for (const node of sorted) {
      const { resolved, sources } = resolveRefs(node.args, outputs);

      yield {
        event: 'tool_call',
        data: {
          id: node.id,
          name: node.tool,
          arguments: resolved,
        },
      };

      const startTime = Date.now();
      let nodeExec: NodeExecution;

      try {
        const result = await this.mcpService.callTool(node.tool, resolved) as {
          content?: { type: string; text?: string; data?: string; mimeType?: string }[];
        };

        // Extract text result
        let resultStr: string;
        if (result?.content && Array.isArray(result.content)) {
          const textParts = result.content
            .filter((b: { type: string; text?: string }) => b.type === 'text' && b.text)
            .map((b: { text?: string }) => b.text);
          resultStr = textParts.join('\n');
        } else {
          resultStr = typeof result === 'string' ? result : JSON.stringify(result);
        }

        // Try to parse as JSON for downstream refs
        let parsedResult: unknown = resultStr;
        try {
          parsedResult = JSON.parse(resultStr);
        } catch {
          // keep as string
        }
        outputs.set(node.id, parsedResult);

        nodeExec = {
          nodeId: node.id,
          tool: node.tool,
          resolvedArgs: resolved,
          argSources: sources,
          output: parsedResult,
          timestamp: new Date(startTime).toISOString(),
          durationMs: Date.now() - startTime,
          status: 'success',
        };

        yield {
          event: 'tool_result',
          data: {
            toolCallId: node.id,
            name: node.tool,
            result: resultStr,
          },
        };

        yield {
          event: 'trace_entry',
          data: {
            id: uuidv4(),
            tool: node.tool,
            args: resolved,
            result: resultStr,
            timestamp: new Date(startTime).toISOString(),
            durationMs: Date.now() - startTime,
          } satisfies ToolTraceEntry,
        };
      } catch (err) {
        const errorStr = `Error calling tool ${node.tool}: ${String(err)}`;
        nodeExec = {
          nodeId: node.id,
          tool: node.tool,
          resolvedArgs: resolved,
          argSources: sources,
          output: null,
          timestamp: new Date(startTime).toISOString(),
          durationMs: Date.now() - startTime,
          status: 'error',
          error: errorStr,
        };
        overallStatus = 'partial';

        yield {
          event: 'tool_result',
          data: {
            toolCallId: node.id,
            name: node.tool,
            result: errorStr,
            isError: true,
          },
        };
      }

      nodeExecutions.push(nodeExec);
    }

    // If all failed, mark as error
    if (nodeExecutions.every(n => n.status === 'error')) {
      overallStatus = 'error';
    }

    const execution: WorkflowExecution = {
      id: uuidv4(),
      workflowId,
      workflowName: workflow.name,
      parameters,
      nodeExecutions,
      startedAt,
      completedAt: new Date().toISOString(),
      status: overallStatus,
    };

    this.storage.saveExecution(execution);

    yield {
      event: 'done',
      data: { executionId: execution.id, status: overallStatus },
    };
  }
}

// --- Helper functions ---

export function buildDependencyMap(
  nodes: WorkflowNode[]
): Map<string, Set<string>> {
  const deps = new Map<string, Set<string>>();
  const nodeIds = new Set(nodes.map(n => n.id));

  for (const node of nodes) {
    const nodeDeps = new Set<string>();
    findRefs(node.args, nodeIds, nodeDeps);
    deps.set(node.id, nodeDeps);
  }

  return deps;
}

function findRefs(
  obj: unknown,
  validIds: Set<string>,
  deps: Set<string>
): void {
  if (obj === null || obj === undefined) return;
  if (typeof obj !== 'object') return;

  if (
    '$ref' in (obj as Record<string, unknown>) &&
    typeof (obj as Record<string, unknown>)['$ref'] === 'string'
  ) {
    const ref = (obj as { $ref: string }).$ref;
    const nodeId = ref.split('.')[0];
    if (nodeId !== '$input' && validIds.has(nodeId)) {
      deps.add(nodeId);
    }
    return;
  }

  for (const value of Object.values(obj as Record<string, unknown>)) {
    findRefs(value, validIds, deps);
  }
}

export function topologicalSort(
  nodes: WorkflowNode[],
  deps: Map<string, Set<string>>
): WorkflowNode[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const [nodeId, nodeDeps] of deps) {
    inDegree.set(nodeId, nodeDeps.size);
    for (const dep of nodeDeps) {
      adjacency.get(dep)?.push(nodeId);
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: WorkflowNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(nodeMap.get(id)!);
    for (const neighbor of adjacency.get(id) || []) {
      const newDegree = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  if (sorted.length !== nodes.length) {
    throw new Error('Workflow contains a cycle');
  }

  return sorted;
}

export function resolveRefs(
  args: Record<string, unknown>,
  outputs: Map<string, unknown>
): { resolved: Record<string, unknown>; sources: Record<string, string> } {
  const sources: Record<string, string> = {};
  const resolved = deepResolve(args, outputs, sources, '');
  return { resolved: resolved as Record<string, unknown>, sources };
}

function deepResolve(
  obj: unknown,
  outputs: Map<string, unknown>,
  sources: Record<string, string>,
  path: string
): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map((item, i) => deepResolve(item, outputs, sources, `${path}[${i}]`));
  }

  const record = obj as Record<string, unknown>;

  // Check for $ref
  if ('$ref' in record && typeof record['$ref'] === 'string') {
    const ref = record['$ref'] as string;
    const parts = ref.split('.');
    const sourceId = parts[0];
    const valuePath = parts.slice(1);

    let value = outputs.get(sourceId);
    for (const key of valuePath) {
      if (value !== null && value !== undefined && typeof value === 'object') {
        value = (value as Record<string, unknown>)[key];
      } else {
        value = undefined;
        break;
      }
    }

    const cleanPath = path.replace(/^\./, '');
    if (cleanPath) {
      sources[cleanPath] = ref;
    }
    return value;
  }

  // Regular object — recurse
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = deepResolve(value, outputs, sources, path ? `${path}.${key}` : key);
  }
  return result;
}

export function extractJSON(text: string): Record<string, unknown> | null {
  // Try to extract JSON from ```json fences
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // fall through
    }
  }

  // Try to find raw JSON object
  const braceStart = text.indexOf('{');
  const braceEnd = text.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    try {
      return JSON.parse(text.substring(braceStart, braceEnd + 1));
    } catch {
      // fall through
    }
  }

  return null;
}
