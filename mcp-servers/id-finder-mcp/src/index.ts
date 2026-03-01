#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

// Types
interface NormalizerInfo {
  input: string;
  category: string;
  curie: string;
  name: string;
}

interface AraxEntityData {
  id: {
    SRI_normalizer_category: string;
    SRI_normalizer_curie: string;
    SRI_normalizer_name: string;
  };
}

type AraxResponse = Record<string, AraxEntityData>;

const ARAX_API_URL = 'https://arax.ncats.io/api/arax/v1.4/entity';

function log(message: string, data?: any): void {
  console.error(`[id-finder-mcp] ${message}`, data ? JSON.stringify(data) : '');
}

// Query ARAX API for entity identification
async function queryAraxApi(entities: string[]): Promise<AraxResponse> {
  const response = await fetch(ARAX_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': '*/*',
    },
    body: JSON.stringify({ terms: entities }),
  });

  if (!response.ok) {
    throw new Error(`ARAX API error: ${response.status}`);
  }

  return await response.json() as AraxResponse;
}

// Extract normalizer info from ARAX response
function extractNormalizerInfo(araxResponse: AraxResponse): NormalizerInfo[] {
  return Object.entries(araxResponse).map(([entityName, data]) => ({
    input: entityName,
    category: data.id?.SRI_normalizer_category || 'Unknown',
    curie: data.id?.SRI_normalizer_curie || 'Unknown',
    name: data.id?.SRI_normalizer_name || 'Unknown',
  }));
}

// Validation schema
const GetNormalizerInfoSchema = z.object({
  entities: z.union([
    z.string().describe('Entity (gene, disease, drug, etc.) to get normalizer info for'),
    z.array(z.string()).describe('Array of entities to get normalizer info for'),
  ]),
});

// Create server
const server = new Server(
  { name: 'id-finder-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

// List tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get-normalizer-info',
      description: 'Get the SRI normalizer information (category, CURIE, name) for one or more biomedical entities. Use this to convert entity names like "BRCA1", "aspirin", or "Alzheimer\'s disease" into standardized CURIE identifiers.',
      inputSchema: {
        type: 'object',
        properties: {
          entities: {
            oneOf: [
              { type: 'string', description: 'Single entity to look up' },
              { type: 'array', items: { type: 'string' }, description: 'Array of entities to look up' },
            ],
            description: 'Single entity or array of entities to get normalizer info for',
          },
        },
        required: ['entities'],
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  log(`Tool call: ${name}`, args);

  try {
    if (name === 'get-normalizer-info') {
      const { entities } = GetNormalizerInfoSchema.parse(args);
      const entityArray = Array.isArray(entities) ? entities : [entities];

      log(`Looking up: ${entityArray.join(', ')}`);

      const araxResponse = await queryAraxApi(entityArray);
      const normalizerInfo = extractNormalizerInfo(araxResponse);

      // Identify unmatched terms
      const matchedTerms = normalizerInfo.map(i => i.input);
      const unmatchedTerms = entityArray.filter(t => !matchedTerms.includes(t));

      // Format response
      let responseText: string;
      if (normalizerInfo.length === 0) {
        responseText = `No matches found for: ${entityArray.join(', ')}.`;
      } else {
        const matchesList = normalizerInfo
          .map(i => `${i.input} (ID: ${i.curie}, Type: ${i.category})`)
          .join(', ');
        responseText = `Found matches: ${matchesList}`;
        if (unmatchedTerms.length > 0) {
          responseText += `. No matches for: ${unmatchedTerms.join(', ')}`;
        }
      }

      const table = '| Input | Category | CURIE | Name |\n|-------|----------|-------|------|\n' +
        normalizerInfo.map(i => `| ${i.input} | ${i.category} | ${i.curie} | ${i.name} |`).join('\n');

      return {
        content: [{
          type: 'text',
          text: `${responseText}\n\n${table}\n\n${JSON.stringify(normalizerInfo, null, 2)}`,
        }],
      };
    }

    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  } catch (error: any) {
    log(`Error: ${error}`);
    return {
      content: [{ type: 'text', text: `Error: ${error.message || error}` }],
      isError: true,
    };
  }
});

// Start
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('Server connected and ready');
}

main().catch((error) => {
  log(`Fatal: ${error}`);
  process.exit(1);
});
