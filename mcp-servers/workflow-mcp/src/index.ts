import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = join(__dirname, '..', '..', '..', 'data', 'workflows');
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

interface WorkflowParameter {
  name: string;
  description: string;
}

interface Workflow {
  id: string;
  name: string;
  description: string;
  parameters: WorkflowParameter[];
}

async function loadWorkflows(): Promise<Map<string, Workflow>> {
  const workflows = new Map<string, Workflow>();
  let files: string[];
  try {
    files = await readdir(WORKFLOWS_DIR);
  } catch {
    console.error(`Workflows directory not found: ${WORKFLOWS_DIR}`);
    return workflows;
  }

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = await readFile(join(WORKFLOWS_DIR, file), 'utf-8');
      const wf = JSON.parse(raw) as Workflow;
      if (wf.name && wf.id) {
        workflows.set(wf.name, wf);
      }
    } catch (err) {
      console.error(`Failed to parse workflow ${file}: ${err}`);
    }
  }

  return workflows;
}

function buildDescription(workflows: Map<string, Workflow>): string {
  const lines = ['Run a saved workflow pipeline. Available workflows:'];
  for (const [name, wf] of workflows) {
    const params = wf.parameters.map((p) => p.name).join(', ');
    const desc = wf.description
      ? wf.description.slice(0, 120) + (wf.description.length > 120 ? '...' : '')
      : '(no description)';
    lines.push(`- ${name}(${params}): ${desc}`);
  }
  if (workflows.size === 0) {
    lines.push('(no workflows currently saved)');
  }
  return lines.join('\n');
}

interface SSEToolResult {
  toolCallId: string;
  name: string;
  result: string;
  isError?: boolean;
  durationMs?: number;
}

async function executeWorkflow(
  workflow: Workflow,
  parameters: Record<string, unknown>
): Promise<{ text: string; isError: boolean }> {
  const url = `${BACKEND_URL}/api/workflows/${workflow.id}/execute`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parameters }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    return { text: `Workflow execution failed (HTTP ${resp.status}): ${body}`, isError: true };
  }

  const text = await resp.text();
  const toolResults: SSEToolResult[] = [];
  let doneStatus = '';
  let errorMsg = '';

  // Parse SSE events from the response body
  for (const chunk of text.split('\n\n')) {
    const eventMatch = chunk.match(/^event:\s*(.+)$/m);
    const dataMatch = chunk.match(/^data:\s*(.+)$/m);
    if (!eventMatch || !dataMatch) continue;

    const eventType = eventMatch[1].trim();
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(dataMatch[1]);
    } catch {
      continue;
    }

    if (eventType === 'tool_result') {
      toolResults.push(data as unknown as SSEToolResult);
    } else if (eventType === 'done') {
      doneStatus = (data.status as string) || '';
    } else if (eventType === 'error') {
      errorMsg = (data.error as string) || 'Unknown error';
    }
  }

  if (errorMsg) {
    return { text: `Workflow error: ${errorMsg}`, isError: true };
  }

  if (toolResults.length === 0) {
    return { text: 'Workflow completed but produced no results.', isError: false };
  }

  // Build summary of all steps
  const summaryLines = [`Workflow "${workflow.name}" completed (status: ${doneStatus || 'unknown'}).`, ''];

  for (let i = 0; i < toolResults.length; i++) {
    const tr = toolResults[i];
    const stepLabel = `Step ${i + 1} (${tr.name})`;
    if (tr.isError) {
      summaryLines.push(`${stepLabel}: ERROR - ${tr.result}`);
    } else {
      summaryLines.push(`${stepLabel}: OK${tr.durationMs ? ` (${tr.durationMs}ms)` : ''}`);
    }
  }

  // Return last successful result as main content
  const lastSuccess = [...toolResults].reverse().find((tr) => !tr.isError);
  if (lastSuccess) {
    summaryLines.push('', '--- Final Result ---', '', lastSuccess.result);
  }

  const hasError = toolResults.some((tr) => tr.isError);
  return { text: summaryLines.join('\n'), isError: hasError };
}

const server = new Server(
  { name: 'workflow-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const workflows = await loadWorkflows();
  return {
    tools: [
      {
        name: 'run_workflow',
        description: buildDescription(workflows),
        inputSchema: {
          type: 'object' as const,
          properties: {
            workflow_name: {
              type: 'string',
              description: 'The name of the workflow to run (must match exactly)',
            },
            parameters: {
              type: 'object',
              description: 'Input parameters for the workflow',
            },
          },
          required: ['workflow_name'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'run_workflow') {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  }

  const args = request.params.arguments as {
    workflow_name?: string;
    parameters?: Record<string, unknown>;
  };

  if (!args?.workflow_name) {
    return {
      content: [{ type: 'text', text: 'workflow_name is required' }],
      isError: true,
    };
  }

  const workflows = await loadWorkflows();
  const workflow = workflows.get(args.workflow_name);
  if (!workflow) {
    const available = [...workflows.keys()].join(', ') || '(none)';
    return {
      content: [
        {
          type: 'text',
          text: `Workflow "${args.workflow_name}" not found. Available: ${available}`,
        },
      ],
      isError: true,
    };
  }

  try {
    const result = await executeWorkflow(workflow, args.parameters || {});
    return {
      content: [{ type: 'text', text: result.text }],
      isError: result.isError,
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Workflow execution failed: ${String(err)}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Workflow MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
