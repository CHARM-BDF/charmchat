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

const EXTRACT_PROMPT = `You are a workflow extraction assistant. Analyze the following tool call trace from a conversation and produce a parameterized, reusable workflow JSON.

CRITICAL RULES:
1. Identify each DISTINCT tool call as a node (skip duplicate calls to the same tool with identical intent)
2. Detect data dependencies: when one tool's output feeds into another tool's args, use { "$ref": "nodeId.path.to.value" }
3. Replace user-provided input values with { "$ref": "$input.paramName" }
4. NEVER hardcode concrete result data into node args. If a node needs data from a previous node's output, always use $ref
5. For script/code nodes that process results from previous steps, reference the previous step's output via $ref — do NOT embed result data in the code. Instead write code that parses the referenced output dynamically.
6. Give the workflow a descriptive name and description

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
    outputs.set('$input', parameters);

    const nodeExecutions: NodeExecution[] = [];
    const failedNodes = new Set<string>();
    const startedAt = new Date().toISOString();
    let overallStatus: WorkflowExecution['status'] = 'success';

    for (const node of sorted) {
      // Check if any dependency failed — skip this node if so
      const nodeDeps = deps.get(node.id) || new Set();
      const failedDep = [...nodeDeps].find(d => failedNodes.has(d));
      if (failedDep) {
        const skipError = `Skipped: dependency "${failedDep}" failed`;
        failedNodes.add(node.id);
        overallStatus = 'partial';

        const nodeExec: NodeExecution = {
          nodeId: node.id,
          tool: node.tool,
          resolvedArgs: {},
          argSources: {},
          output: null,
          timestamp: new Date().toISOString(),
          durationMs: 0,
          status: 'error',
          error: skipError,
        };
        nodeExecutions.push(nodeExec);

        yield {
          event: 'tool_result',
          data: {
            toolCallId: node.id,
            name: node.tool,
            result: skipError,
            isError: true,
          },
        };
        continue;
      }

      const { resolved, sources, unresolvedRefs } = resolveRefs(node.args, outputs);

      // If there are unresolved $refs, fail this node
      if (unresolvedRefs.length > 0) {
        const refError = `Unresolved references: ${unresolvedRefs.join(', ')}`;
        failedNodes.add(node.id);
        overallStatus = 'partial';

        const nodeExec: NodeExecution = {
          nodeId: node.id,
          tool: node.tool,
          resolvedArgs: resolved,
          argSources: sources,
          output: null,
          timestamp: new Date().toISOString(),
          durationMs: 0,
          status: 'error',
          error: refError,
        };
        nodeExecutions.push(nodeExec);

        yield {
          event: 'tool_result',
          data: {
            toolCallId: node.id,
            name: node.tool,
            result: refError,
            isError: true,
          },
        };
        continue;
      }

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
          content?: { type: string; text?: string; data?: string; mimeType?: string; isError?: boolean }[];
          isError?: boolean;
        };

        // Extract text result and detect errors
        let resultStr: string;
        let isToolError = false;

        if (result?.content && Array.isArray(result.content)) {
          const textParts = result.content
            .filter((b: { type: string; text?: string }) => b.type === 'text' && b.text)
            .map((b: { text?: string }) => b.text);
          resultStr = textParts.join('\n');
          // Check for isError flag on any content block or the result itself
          isToolError = result.isError === true ||
            result.content.some((b: { isError?: boolean }) => b.isError === true);
        } else {
          resultStr = typeof result === 'string' ? result : JSON.stringify(result);
        }

        // Also detect error-like results by content pattern
        if (!isToolError && typeof resultStr === 'string') {
          const lower = resultStr.toLowerCase();
          if (lower.startsWith('error:') || lower.startsWith('error calling')) {
            isToolError = true;
          }
        }

        if (isToolError) {
          const durationMs = Date.now() - startTime;
          failedNodes.add(node.id);
          overallStatus = 'partial';
          nodeExec = {
            nodeId: node.id,
            tool: node.tool,
            resolvedArgs: resolved,
            argSources: sources,
            output: resultStr,
            timestamp: new Date(startTime).toISOString(),
            durationMs,
            status: 'error',
            error: resultStr,
          };

          yield {
            event: 'tool_result',
            data: {
              toolCallId: node.id,
              name: node.tool,
              result: resultStr,
              isError: true,
              durationMs,
            },
          };
        } else {
          // Try to parse as JSON for downstream refs
          let parsedResult: unknown = resultStr;
          try {
            parsedResult = JSON.parse(resultStr);
          } catch {
            // keep as string
          }
          outputs.set(node.id, parsedResult);

          const durationMs = Date.now() - startTime;
          nodeExec = {
            nodeId: node.id,
            tool: node.tool,
            resolvedArgs: resolved,
            argSources: sources,
            output: parsedResult,
            timestamp: new Date(startTime).toISOString(),
            durationMs,
            status: 'success',
          };

          yield {
            event: 'tool_result',
            data: {
              toolCallId: node.id,
              name: node.tool,
              result: resultStr,
              durationMs,
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
        }
      } catch (err) {
        const errorStr = `Error calling tool ${node.tool}: ${String(err)}`;
        failedNodes.add(node.id);
        overallStatus = 'partial';

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
    if (nodeExecutions.length > 0 && nodeExecutions.every(n => n.status === 'error')) {
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
): { resolved: Record<string, unknown>; sources: Record<string, string>; unresolvedRefs: string[] } {
  const sources: Record<string, string> = {};
  const unresolvedRefs: string[] = [];
  const resolved = deepResolve(args, outputs, sources, '', unresolvedRefs);
  return { resolved: resolved as Record<string, unknown>, sources, unresolvedRefs };
}

function deepResolve(
  obj: unknown,
  outputs: Map<string, unknown>,
  sources: Record<string, string>,
  path: string,
  unresolvedRefs: string[]
): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map((item, i) => deepResolve(item, outputs, sources, `${path}[${i}]`, unresolvedRefs));
  }

  const record = obj as Record<string, unknown>;

  // Check for $ref
  if ('$ref' in record && typeof record['$ref'] === 'string') {
    const ref = record['$ref'] as string;
    const parts = ref.split('.');
    const sourceId = parts[0];
    const valuePath = parts.slice(1);

    if (!outputs.has(sourceId)) {
      unresolvedRefs.push(ref);
      return undefined;
    }

    let value = outputs.get(sourceId);
    for (const key of valuePath) {
      if (value !== null && value !== undefined && typeof value === 'object') {
        value = (value as Record<string, unknown>)[key];
      } else {
        unresolvedRefs.push(ref);
        return undefined;
      }
    }

    if (value === undefined) {
      unresolvedRefs.push(ref);
      return undefined;
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
    result[key] = deepResolve(value, outputs, sources, path ? `${path}.${key}` : key, unresolvedRefs);
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
