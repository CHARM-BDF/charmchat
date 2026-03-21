#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// Load environment variables
import dotenv from "dotenv";
dotenv.config();

// DGIdb MCP Configuration
const API_BASE_URL = process.env.DGIDB_BASE_URL || "https://biothings.ncats.io/dgidb";
const TOOL_NAME = "dgidb-mcp";
const SERVICE_NAME = "dgidb";

// DGIdb Query Schema
const DGIdbQuerySchema = z.object({
  query: z.string().min(1, "Query cannot be empty"),
  fields: z.string().optional().default("all"),
  size: z.number().min(1).max(1000).optional().default(10),
  from: z.number().min(0).optional().default(0),
  sort: z.array(z.string()).optional(),
  scopes: z.array(z.string()).optional(),
  facets: z.array(z.string()).optional(),
  facet_size: z.number().min(1).max(1000).optional().default(10),
  fetch_all: z.boolean().optional().default(false),
  scroll_id: z.string().optional(),
  dotfield: z.boolean().optional().default(false),
  email: z.string().email().optional(),
  callback: z.string().optional(),
});

// DGIdb Association Schema
const DGIdbAssociationSchema = z.object({
  association_id: z.string().min(1, "Association ID cannot be empty"),
  fields: z.string().optional().default("all"),
  email: z.string().email().optional(),
  size: z.number().min(1).max(1000).optional().default(10),
  callback: z.string().optional(),
});

// DGIdb Batch Association Schema
const DGIdbBatchAssociationSchema = z.object({
  association_ids: z.array(z.string()).min(1, "At least one association ID is required").max(1000, "Maximum 1000 associations per request"),
  fields: z.string().optional().default("all"),
  email: z.string().email().optional(),
  size: z.number().min(1).max(1000).optional().default(10),
});

// DGIdb Metadata Schema
const DGIdbMetadataSchema = z.object({});

// DGIdb Fields Schema
const DGIdbFieldsSchema = z.object({});

// Make DGIdb API request
async function makeDGIdbRequest(endpoint: string, method: 'GET' | 'POST' = 'GET', body?: any, params?: Record<string, any>): Promise<any> {
  const url = new URL(`${API_BASE_URL}${endpoint}`);
  
  // Add query parameters for GET requests
  if (method === 'GET' && params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          url.searchParams.set(key, value.join(','));
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    });
  }
  
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'User-Agent': `${SERVICE_NAME}-mcp/1.0.0`,
  };

  // Only add Content-Type for POST requests
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
  }

  console.log(`[${SERVICE_NAME}] Making DGIdb request to: ${url.toString()}`);

  try {
    const requestOptions: RequestInit = {
      method,
      headers,
    };

    if (method === 'POST' && body) {
      requestOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url.toString(), requestOptions);
    
    console.log(`[${SERVICE_NAME}] Response status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`DGIdb resource not found: ${endpoint}`);
      }
      if (response.status === 400) {
        const errorText = await response.text();
        throw new Error(`Invalid DGIdb request: ${errorText}`);
      }
      if (response.status === 413) {
        throw new Error(`Payload too large. Batch size exceeds limit of 1000.`);
      }
      if (response.status === 429) {
        throw new Error(`Rate limit exceeded. Please wait before retrying.`);
      }
      if (response.status === 500) {
        throw new Error(`Internal server error in DGIdb service.`);
      }
      throw new Error(`DGIdb request failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`[${SERVICE_NAME}] DGIdb request error:`, error);
    throw error;
  }
}

// Format DGIdb query response for Claude consumption
function formatDGIdbQueryForModel(response: any, query: string): string {
  const hits = response.hits || [];
  const total = response.total || 0;
  
  let output = [
    `**DGIdb Query Results**`,
    `**Query:** ${query}`,
    `**Total Results:** ${total}`,
    `**Returned:** ${hits.length}`,
    ""
  ];

  if (hits.length > 0) {
    output.push("## Drug-Gene Interaction Results");
    hits.slice(0, 10).forEach((hit: any, index: number) => {
      const association = hit.association || {};
      const subject = hit.subject || {};
      const object = hit.object || {};
      
      output.push(`### Result ${index + 1}`);
      output.push(`**Association ID:** ${hit._id || 'Unknown'}`);
      output.push(`**Drug:** ${subject.name || 'Unknown'} (${subject.id || 'No ID'})`);
      output.push(`**Gene:** ${object.name || 'Unknown'} (${object.id || 'No ID'})`);
      
      if (association.interaction_types) {
        const interactionTypes = Array.isArray(association.interaction_types) 
          ? association.interaction_types 
          : [association.interaction_types];
        if (interactionTypes.length > 0) {
          output.push(`**Interaction Types:** ${interactionTypes.join(', ')}`);
        }
      }
      
      if (association.pmids && association.pmids.length > 0) {
        output.push(`**References:** ${association.pmids.slice(0, 3).join(', ')}${association.pmids.length > 3 ? '...' : ''}`);
      }
      
      output.push("");
    });
    
    if (hits.length > 10) {
      output.push(`... and ${hits.length - 10} more results`);
    }
  } else {
    output.push("No drug-gene interactions found matching your query.");
  }

  return output.join("\n");
}

// Format DGIdb association response for Claude consumption
function formatDGIdbAssociationForModel(response: any, associationId: string): string {
  const association = response.association || {};
  const subject = response.subject || {};
  const object = response.object || {};
  
  let output = [
    `**DGIdb Association Details**`,
    `**Association ID:** ${associationId}`,
    "",
    "## Drug Information",
    `**Name:** ${subject.name || 'Unknown'}`,
    `**ID:** ${subject.id || 'No ID'}`,
    `**Type:** ${subject.type || 'Unknown'}`,
    "",
    "## Gene Information", 
    `**Name:** ${object.name || 'Unknown'}`,
    `**ID:** ${object.id || 'No ID'}`,
    `**Type:** ${object.type || 'Unknown'}`,
    ""
  ];

  if (association.interaction_types) {
    const interactionTypes = Array.isArray(association.interaction_types) 
      ? association.interaction_types 
      : [association.interaction_types];
    if (interactionTypes.length > 0) {
      output.push("## Interaction Types");
      interactionTypes.forEach((type: string) => {
        output.push(`- **${type}**`);
      });
      output.push("");
    }
  }

  if (association.pmids && association.pmids.length > 0) {
    output.push("## References");
    output.push(`**PubMed IDs:** ${association.pmids.join(', ')}`);
    output.push("");
  }

  if (association.sources && association.sources.length > 0) {
    output.push("## Data Sources");
    association.sources.forEach((source: string) => {
      output.push(`- ${source}`);
    });
  }

  return output.join("\n");
}

// Format DGIdb metadata for Claude consumption
function formatDGIdbMetadataForModel(response: any): string {
  const stats = response.stats || {};
  const build = response.build || {};
  
  let output = [
    `**DGIdb Database Metadata**`,
    `**Build Date:** ${build.timestamp || 'Unknown'}`,
    `**Version:** ${build.version || 'Unknown'}`,
    "",
    "## Database Statistics",
    `**Total Associations:** ${stats.total_associations || 'Unknown'}`,
    `**Total Drugs:** ${stats.total_drugs || 'Unknown'}`,
    `**Total Genes:** ${stats.total_genes || 'Unknown'}`,
    `**Total Interactions:** ${stats.total_interactions || 'Unknown'}`,
    ""
  ];

  if (response.available_fields) {
    output.push("## Available Fields");
    const fields = Object.keys(response.available_fields).slice(0, 20);
    fields.forEach(field => {
      output.push(`- ${field}`);
    });
    if (Object.keys(response.available_fields).length > 20) {
      output.push(`... and ${Object.keys(response.available_fields).length - 20} more fields`);
    }
  }

  return output.join("\n");
}

// Format DGIdb data for artifacts
function formatDGIdbArtifactData(response: any, queryParams: any, queryType: string): any {
  return {
    query_type: queryType,
    query_params: queryParams,
    response: {
      total: response.total || 0,
      hits_count: response.hits?.length || 0,
      max_score: response.max_score,
      took: response.took,
    },
    data: response,
    metadata: {
      timestamp: new Date().toISOString(),
      service: "BioThings DGIdb API",
      endpoint: API_BASE_URL,
      version: "4.2.0",
    }
  };
}

// Create the MCP server
const server = new Server(
  {
    name: TOOL_NAME,
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define tools
const tools: Tool[] = [
  {
    name: "query-dgidb",
    description: "Query the DGIdb (Drug-Gene Interaction Database) for comprehensive drug-gene interaction data using BioThings query syntax. Supports detailed interaction types like inhibitor, agonist, antagonist, activator, blocker, modulator, etc.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "BioThings query string (e.g., 'subject.CHEMBL_COMPOUND:CHEMBL1017', 'object.NCBIGene:673')"
        },
        fields: {
          type: "string",
          default: "all",
          description: "Comma-separated list of fields to return (default: 'all')"
        },
        size: {
          type: "number",
          minimum: 1,
          maximum: 1000,
          default: 10,
          description: "Maximum number of results to return (default: 10, max: 1000)"
        },
        from: {
          type: "number",
          minimum: 0,
          default: 0,
          description: "Number of results to skip for pagination (default: 0)"
        },
        sort: {
          type: "array",
          items: { type: "string" },
          description: "Fields to sort by (prefix with '-' for descending order)"
        },
        scopes: {
          type: "array",
          items: { type: "string" },
          description: "Fields to search in (default: '_id')"
        },
        facets: {
          type: "array",
          items: { type: "string" },
          description: "Fields to return facets for"
        },
        facet_size: {
          type: "number",
          minimum: 1,
          maximum: 1000,
          default: 10,
          description: "Number of facet buckets to return (default: 10)"
        },
        fetch_all: {
          type: "boolean",
          default: false,
          description: "Fetch all results using scrolling (default: false)"
        },
        scroll_id: {
          type: "string",
          description: "Scroll ID for pagination when fetch_all is true"
        },
        dotfield: {
          type: "boolean",
          default: false,
          description: "Return flattened object with dot notation (default: false)"
        },
        email: {
          type: "string",
          format: "email",
          description: "Optional email for usage tracking"
        },
        callback: {
          type: "string",
          description: "JSONP callback function name"
        }
      },
      required: ["query"]
    }
  },
  {
    name: "get-dgidb-association",
    description: "Get detailed information about a specific drug-gene interaction association by its ID from the DGIdb database.",
    inputSchema: {
      type: "object",
      properties: {
        association_id: {
          type: "string",
          description: "The association ID (e.g., '1fb7c7f0ef333cd2')"
        },
        fields: {
          type: "string",
          default: "all",
          description: "Comma-separated list of fields to return (default: 'all')"
        },
        email: {
          type: "string",
          format: "email",
          description: "Optional email for usage tracking"
        },
        size: {
          type: "number",
          minimum: 1,
          maximum: 1000,
          default: 10,
          description: "Maximum number of results to return (default: 10)"
        },
        callback: {
          type: "string",
          description: "JSONP callback function name"
        }
      },
      required: ["association_id"]
    }
  },
  {
    name: "get-dgidb-associations-batch",
    description: "Get detailed information about multiple drug-gene interaction associations by their IDs from the DGIdb database (up to 1000 associations).",
    inputSchema: {
      type: "object",
      properties: {
        association_ids: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 1000,
          description: "Array of association IDs (max 1000)"
        },
        fields: {
          type: "string",
          default: "all",
          description: "Comma-separated list of fields to return (default: 'all')"
        },
        email: {
          type: "string",
          format: "email",
          description: "Optional email for usage tracking"
        },
        size: {
          type: "number",
          minimum: 1,
          maximum: 1000,
          default: 10,
          description: "Maximum number of results to return (default: 10)"
        }
      },
      required: ["association_ids"]
    }
  },
  {
    name: "get-dgidb-metadata",
    description: "Get metadata about the DGIdb database including statistics, build information, and available fields.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "get-dgidb-fields",
    description: "Get information about available data fields in the DGIdb database.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  }
];

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Tool execution handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "query-dgidb") {
      const queryParams = DGIdbQuerySchema.parse(args);
      
      console.log(`[${SERVICE_NAME}] Querying DGIdb with: ${queryParams.query}`);
      
      const params: Record<string, any> = {
        q: queryParams.query,
        fields: queryParams.fields,
        size: queryParams.size,
        from: queryParams.from,
        fetch_all: queryParams.fetch_all,
        dotfield: queryParams.dotfield,
      };

      if (queryParams.sort) {
        params.sort = queryParams.sort;
      }
      if (queryParams.scopes) {
        params.scopes = queryParams.scopes;
      }
      if (queryParams.facets) {
        params.facets = queryParams.facets;
      }
      if (queryParams.facet_size) {
        params.facet_size = queryParams.facet_size;
      }
      if (queryParams.scroll_id) {
        params.scroll_id = queryParams.scroll_id;
      }
      if (queryParams.email) {
        params.email = queryParams.email;
      }
      if (queryParams.callback) {
        params.callback = queryParams.callback;
      }

      const response = await makeDGIdbRequest("/query", "GET", undefined, params);
      
      const formattedResponse = formatDGIdbQueryForModel(response, queryParams.query);
      const artifactData = formatDGIdbArtifactData(response, queryParams, "query");

      return {
        content: [
          {
            type: "text",
            text: formattedResponse
          }
        ],
        artifacts: [
          {
            type: "application/json",
            title: "DGIdb Query Results",
            name: "dgidb_query_results.json",
            content: artifactData
          }
        ]
      };
    }

    if (name === "get-dgidb-association") {
      const associationParams = DGIdbAssociationSchema.parse(args);
      
      console.log(`[${SERVICE_NAME}] Getting DGIdb association: ${associationParams.association_id}`);
      
      const params: Record<string, any> = {
        fields: associationParams.fields,
        size: associationParams.size,
      };

      if (associationParams.email) {
        params.email = associationParams.email;
      }
      if (associationParams.callback) {
        params.callback = associationParams.callback;
      }

      const response = await makeDGIdbRequest(`/association/${associationParams.association_id}`, "GET", undefined, params);
      
      const formattedResponse = formatDGIdbAssociationForModel(response, associationParams.association_id);
      const artifactData = formatDGIdbArtifactData(response, associationParams, "association");

      return {
        content: [
          {
            type: "text",
            text: formattedResponse
          }
        ],
        artifacts: [
          {
            type: "application/json",
            title: "DGIdb Association Details",
            name: `dgidb_association_${associationParams.association_id}.json`,
            content: artifactData
          }
        ]
      };
    }

    if (name === "get-dgidb-associations-batch") {
      const batchParams = DGIdbBatchAssociationSchema.parse(args);
      
      console.log(`[${SERVICE_NAME}] Getting DGIdb associations batch: ${batchParams.association_ids.length} associations`);
      
      const body = {
        ids: batchParams.association_ids
      };

      const params: Record<string, any> = {
        fields: batchParams.fields,
        size: batchParams.size,
      };

      if (batchParams.email) {
        params.email = batchParams.email;
      }

      const response = await makeDGIdbRequest("/association", "POST", body, params);
      
      const formattedResponse = [
        `**DGIdb Batch Association Results**`,
        `**Requested:** ${batchParams.association_ids.length} associations`,
        `**Returned:** ${Object.keys(response).length} associations`,
        "",
        "## Association Summary"
      ];

      Object.entries(response).forEach(([id, data]: [string, any]) => {
        const association = data.association || {};
        const subject = data.subject || {};
        const object = data.object || {};
        
        formattedResponse.push(`### ${id}`);
        formattedResponse.push(`**Drug:** ${subject.name || 'Unknown'}`);
        formattedResponse.push(`**Gene:** ${object.name || 'Unknown'}`);
        if (association.interaction_types) {
          const interactionTypes = Array.isArray(association.interaction_types) 
            ? association.interaction_types 
            : [association.interaction_types];
          if (interactionTypes.length > 0) {
            formattedResponse.push(`**Interaction Types:** ${interactionTypes.join(', ')}`);
          }
        }
        formattedResponse.push("");
      });

      const artifactData = formatDGIdbArtifactData(response, batchParams, "batch_associations");

      return {
        content: [
          {
            type: "text",
            text: formattedResponse.join("\n")
          }
        ],
        artifacts: [
          {
            type: "application/json",
            title: "DGIdb Batch Association Results",
            name: "dgidb_batch_associations.json",
            content: artifactData
          }
        ]
      };
    }

    if (name === "get-dgidb-metadata") {
      const metadataParams = DGIdbMetadataSchema.parse(args);
      
      console.log(`[${SERVICE_NAME}] Getting DGIdb metadata`);
      
      const response = await makeDGIdbRequest("/metadata", "GET");
      
      const formattedResponse = formatDGIdbMetadataForModel(response);
      const artifactData = formatDGIdbArtifactData(response, metadataParams, "metadata");

      return {
        content: [
          {
            type: "text",
            text: formattedResponse
          }
        ],
        artifacts: [
          {
            type: "application/json",
            title: "DGIdb Database Metadata",
            name: "dgidb_metadata.json",
            content: artifactData
          }
        ]
      };
    }

    if (name === "get-dgidb-fields") {
      const fieldsParams = DGIdbFieldsSchema.parse(args);
      
      console.log(`[${SERVICE_NAME}] Getting DGIdb fields`);
      
      const response = await makeDGIdbRequest("/metadata/fields", "GET");
      
      const formattedResponse = [
        `**DGIdb Available Fields**`,
        `**Total Fields:** ${Object.keys(response).length}`,
        ""
      ];

      const fields = Object.keys(response).slice(0, 50);
      formattedResponse.push("## Field List");
      fields.forEach(field => {
        formattedResponse.push(`- ${field}`);
      });
      
      if (Object.keys(response).length > 50) {
        formattedResponse.push(`... and ${Object.keys(response).length - 50} more fields`);
      }

      const artifactData = formatDGIdbArtifactData(response, fieldsParams, "fields");

      return {
        content: [
          {
            type: "text",
            text: formattedResponse.join("\n")
          }
        ],
        artifacts: [
          {
            type: "application/json",
            title: "DGIdb Available Fields",
            name: "dgidb_fields.json",
            content: artifactData
          }
        ]
      };
    }

    throw new Error(`Unknown tool: ${name}`);

  } catch (error) {
    console.error(`[${SERVICE_NAME}] Tool execution error:`, error);
    
    if (error instanceof z.ZodError) {
      return {
        content: [
          {
            type: "text",
            text: `Invalid input parameters: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`
          }
        ]
      };
    }
    
    throw new Error(`Failed to execute ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${TOOL_NAME} server running on stdio`);
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
