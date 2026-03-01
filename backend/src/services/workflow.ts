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

const EXTRACT_PROMPT = `You are a workflow extraction assistant. Analyze the following tool call trace and produce a parameterized, reusable workflow JSON.

RULES:
1. Each distinct MCP tool call becomes a node (skip redundant/duplicate calls)
2. Replace user-provided input values with {{input.paramName}} mustache templates
3. When one tool's arg uses a value from a previous tool's output, use {{stepN.path.to.field}}
4. Tool outputs are auto-parsed: if a result contains JSON (e.g. an array of objects), the first element is unwrapped automatically, so "{{step1.curie}}" accesses the curie field directly
5. NEVER hardcode concrete result data into node args
6. Use {{stepN}} to reference the entire output of a step (stringified if embedded in a larger string)

The mustache syntax works uniformly everywhere — in standalone string values AND embedded inside longer strings (like code). At runtime, each {{...}} is replaced with the resolved value.

Examples:
- Standalone arg: "entity": "{{step1.curie}}"
- User input: "entities": "{{input.geneName}}"
- Inside code: "data = json.loads('''{{step2}}''')"
- Field access in code: "curie = '{{step1.curie}}'"

Tool trace:
\`\`\`json
TRACE_PLACEHOLDER
\`\`\`

Respond with ONLY a JSON object:
\`\`\`json
{
  "name": "descriptive workflow name",
  "description": "what this workflow does",
  "parameters": [{ "name": "paramName", "description": "what this parameter is" }],
  "nodes": [
    {
      "id": "step1",
      "tool": "server__tool_name",
      "args": { "key": "{{input.x}} or {{step1.field}} or concrete value" }
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

    const prompt = EXTRACT_PROMPT.replace('TRACE_PLACEHOLDER', JSON.stringify(conversation.toolTrace, null, 2));
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
    outputs.set('input', parameters);

    const nodeExecutions: NodeExecution[] = [];
    const failedNodes = new Set<string>();
    const startedAt = new Date().toISOString();
    let overallStatus: WorkflowExecution['status'] = 'success';

    for (const node of sorted) {
      // Check if any dependency failed — skip this node
      const nodeDeps = deps.get(node.id) || new Set();
      const failedDep = [...nodeDeps].find(d => failedNodes.has(d));
      if (failedDep) {
        const skipError = `Skipped: dependency "${failedDep}" failed`;
        failedNodes.add(node.id);
        overallStatus = 'partial';

        nodeExecutions.push({
          nodeId: node.id,
          tool: node.tool,
          resolvedArgs: {},
          argSources: {},
          output: null,
          timestamp: new Date().toISOString(),
          durationMs: 0,
          status: 'error',
          error: skipError,
        });

        yield {
          event: 'tool_result',
          data: { toolCallId: node.id, name: node.tool, result: skipError, isError: true },
        };
        continue;
      }

      const { resolved, sources, unresolvedRefs } = resolveTemplates(node.args, outputs);

      if (unresolvedRefs.length > 0) {
        const refError = `Unresolved references: ${unresolvedRefs.join(', ')}`;
        failedNodes.add(node.id);
        overallStatus = 'partial';

        nodeExecutions.push({
          nodeId: node.id,
          tool: node.tool,
          resolvedArgs: resolved,
          argSources: sources,
          output: null,
          timestamp: new Date().toISOString(),
          durationMs: 0,
          status: 'error',
          error: refError,
        });

        yield {
          event: 'tool_result',
          data: { toolCallId: node.id, name: node.tool, result: refError, isError: true },
        };
        continue;
      }

      yield {
        event: 'tool_call',
        data: { id: node.id, name: node.tool, arguments: resolved },
      };

      const startTime = Date.now();
      let nodeExec: NodeExecution;

      try {
        const result = await this.mcpService.callTool(node.tool, resolved) as {
          content?: { type: string; text?: string; data?: string; mimeType?: string; isError?: boolean }[];
          isError?: boolean;
        };

        let resultStr: string;
        let isToolError = false;

        if (result?.content && Array.isArray(result.content)) {
          const textParts = result.content
            .filter((b: { type: string; text?: string }) => b.type === 'text' && b.text)
            .map((b: { text?: string }) => b.text);
          resultStr = textParts.join('\n');
          isToolError = result.isError === true ||
            result.content.some((b: { isError?: boolean }) => b.isError === true);
        } else {
          resultStr = typeof result === 'string' ? result : JSON.stringify(result);
        }

        if (!isToolError && typeof resultStr === 'string') {
          const lower = resultStr.toLowerCase();
          if (lower.startsWith('error:') || lower.startsWith('error calling') ||
              lower.startsWith('execution failed:')) {
            isToolError = true;
          }
        }

        const durationMs = Date.now() - startTime;

        if (isToolError) {
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
            data: { toolCallId: node.id, name: node.tool, result: resultStr, isError: true, durationMs },
          };
        } else {
          const parsedResult = parseToolOutput(resultStr);
          outputs.set(node.id, parsedResult);

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
            data: { toolCallId: node.id, name: node.tool, result: resultStr, durationMs },
          };

          yield {
            event: 'trace_entry',
            data: {
              id: uuidv4(),
              tool: node.tool,
              args: resolved,
              result: resultStr,
              timestamp: new Date(startTime).toISOString(),
              durationMs,
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
          data: { toolCallId: node.id, name: node.tool, result: errorStr, isError: true },
        };
      }

      nodeExecutions.push(nodeExec);
    }

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

/** Regex matching {{path.to.value}} mustache templates */
const MUSTACHE_RE = /\{\{([^}]+)\}\}/g;

export function buildDependencyMap(
  nodes: WorkflowNode[]
): Map<string, Set<string>> {
  const deps = new Map<string, Set<string>>();
  const nodeIds = new Set(nodes.map(n => n.id));

  for (const node of nodes) {
    const nodeDeps = new Set<string>();
    findTemplateRefs(node.args, nodeIds, nodeDeps);
    deps.set(node.id, nodeDeps);
  }

  return deps;
}

function findTemplateRefs(
  obj: unknown,
  validIds: Set<string>,
  deps: Set<string>
): void {
  if (obj === null || obj === undefined) return;

  if (typeof obj === 'string') {
    let match;
    MUSTACHE_RE.lastIndex = 0;
    while ((match = MUSTACHE_RE.exec(obj)) !== null) {
      const nodeId = match[1].trim().split('.')[0];
      if (nodeId !== 'input' && validIds.has(nodeId)) {
        deps.add(nodeId);
      }
    }
    return;
  }

  if (typeof obj !== 'object') return;

  for (const value of Object.values(obj as Record<string, unknown>)) {
    findTemplateRefs(value, validIds, deps);
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

export function resolveTemplates(
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

  if (typeof obj === 'string') {
    MUSTACHE_RE.lastIndex = 0;
    if (!MUSTACHE_RE.test(obj)) return obj;

    // If the entire string is a single template, resolve to the raw value (preserves type)
    MUSTACHE_RE.lastIndex = 0;
    const fullMatch = obj.match(/^\{\{([^}]+)\}\}$/);
    if (fullMatch) {
      const ref = fullMatch[1].trim();
      const value = resolvePath(ref, outputs);
      if (value === undefined) {
        unresolvedRefs.push(ref);
        return undefined;
      }
      const cleanPath = path.replace(/^\./, '');
      if (cleanPath) sources[cleanPath] = ref;
      return value;
    }

    // Otherwise, string interpolation — replace each {{...}} with stringified value
    MUSTACHE_RE.lastIndex = 0;
    return obj.replace(MUSTACHE_RE, (_match, ref: string) => {
      const trimmed = ref.trim();
      const value = resolvePath(trimmed, outputs);
      if (value === undefined) {
        unresolvedRefs.push(trimmed);
        return `<unresolved: ${trimmed}>`;
      }
      const cleanPath = path.replace(/^\./, '');
      if (cleanPath) sources[cleanPath] = trimmed;
      return typeof value === 'string' ? value : JSON.stringify(value);
    });
  }

  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map((item, i) => deepResolve(item, outputs, sources, `${path}[${i}]`, unresolvedRefs));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[key] = deepResolve(value, outputs, sources, path ? `${path}.${key}` : key, unresolvedRefs);
  }
  return result;
}

/** Resolve a dotted path like "step1.curie" against the outputs map */
function resolvePath(ref: string, outputs: Map<string, unknown>): unknown {
  const parts = ref.split('.');
  const sourceId = parts[0];
  const valuePath = parts.slice(1);

  if (!outputs.has(sourceId)) return undefined;

  let value = outputs.get(sourceId);
  for (const key of valuePath) {
    if (value !== null && value !== undefined && typeof value === 'object') {
      value = (value as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return value;
}

/**
 * Parse tool output into a structured form for downstream template access.
 * Many MCP tools return mixed text + JSON. Extracts the JSON portion
 * so paths like "step1.curie" can resolve.
 * Single-element arrays are unwrapped so "step1.curie" works
 * without needing "step1[0].curie".
 */
export function parseToolOutput(resultStr: string): unknown {
  // Direct JSON parse
  try {
    const parsed = JSON.parse(resultStr);
    if (Array.isArray(parsed) && parsed.length === 1) return parsed[0];
    return parsed;
  } catch { /* not pure JSON */ }

  // Extract JSON array from mixed text
  const arrayMatch = resultStr.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed) && parsed.length === 1) return parsed[0];
      return parsed;
    } catch { /* fall through */ }
  }

  // Extract JSON object from mixed text
  const objMatch = resultStr.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]);
    } catch { /* fall through */ }
  }

  return resultStr;
}

export function extractJSON(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch { /* fall through */ }
  }

  const braceStart = text.indexOf('{');
  const braceEnd = text.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    try {
      return JSON.parse(text.substring(braceStart, braceEnd + 1));
    } catch { /* fall through */ }
  }

  return null;
}
