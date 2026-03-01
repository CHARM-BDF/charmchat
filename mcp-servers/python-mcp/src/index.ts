import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { execute } from './execute.js';

const server = new Server(
  { name: 'python-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'execute_python',
      description: `Execute Python code in a sandboxed Docker container.

Pre-installed libraries: numpy, pandas, scipy, scikit-learn, matplotlib, seaborn, plotly, statsmodels, requests, beautifulsoup4.

To save plots, use plt.savefig('filename.png') — paths are auto-transformed to use the output directory.

stdout/stderr is captured and returned. Images are returned as base64. Timeout: 30s. Memory: 256MB.`,
      inputSchema: {
        type: 'object' as const,
        properties: {
          code: {
            type: 'string',
            description: 'Python code to execute',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in seconds (max 60, default 30)',
          },
        },
        required: ['code'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'execute_python') {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  }

  const args = request.params.arguments as { code: string; timeout?: number };
  if (!args.code) {
    return {
      content: [{ type: 'text', text: 'code is required' }],
      isError: true,
    };
  }

  const timeout = Math.min(args.timeout || 30, 60);

  try {
    const result = await execute(args.code, timeout);

    const content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] = [];

    // Add text output
    if (result.output) {
      content.push({ type: 'text', text: result.output });
    }

    // Add images
    for (const file of result.files) {
      content.push({
        type: 'image',
        data: file.base64,
        mimeType: file.mimeType,
      });
      content.push({ type: 'text', text: `[Generated: ${file.filename}]` });
    }

    // Add error if any
    if (result.error) {
      content.push({ type: 'text', text: `\nError:\n${result.error}` });
    }

    if (content.length === 0) {
      content.push({ type: 'text', text: '(no output)' });
    }

    return { content, isError: !!result.error };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Execution failed: ${String(err)}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Python MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
