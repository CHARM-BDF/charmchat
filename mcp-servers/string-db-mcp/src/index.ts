import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { formatProteinInteractionsGraph, formatPathwayEnrichmentGraph, formatEvidenceScores } from "./formatters.js";

// STRING-db API configuration
const STRING_API_BASE = "https://string-db.org/api/json";
const DEBUG = true;

interface StringIdResponse {
    queryIndex: number;
    queryItem: string;
    stringId: string;
    ncbiTaxonId: number;
    taxonName: string;
    preferredName: string;
    annotation: string;
}

interface InteractionResponse {
    stringId_A: string;
    stringId_B: string;
    preferredName_A: string;
    preferredName_B: string;
    ncbiTaxonId: number;
    score: number;
    nscore: number;
    fscore: number;
    pscore: number;
    ascore: number;
    escore: number;
    dscore: number;
    tscore: number;
}

interface DetailedEvidence {
    text_mining?: {
        publications?: string[];
    };
}

interface InteractionResponseWithEvidence extends InteractionResponse {
    detailedEvidence?: DetailedEvidence | null;  // Changed this line to allow null
}


// Define validation schemas
const ProteinInteractionsSchema = z.object({
    protein: z.string(),
    species: z.number().optional().default(9606), // Default to human
    required_score: z.number().min(0).max(1000).optional().default(400),
    limit: z.number().min(1).max(50).optional().default(10)
});

const PathwayEnrichmentSchema = z.object({
    proteins: z.array(z.string()),
    species: z.number().optional().default(9606)
});

// Create server instance
const server = new Server(
    {
        name: "string-db",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
            logging: {}  // Add logging capability
        },
    }
);

// Helper function for API requests
async function makeStringDBRequest<T>(endpoint: string, params: Record<string, any>): Promise<T | null> {
    const queryString = new URLSearchParams(params).toString();
    const url = `${STRING_API_BASE}/${endpoint}?${queryString}`;
    
    console.error(`DEBUG: Making request to: ${url}`);  // Added detailed logging

    try {
        const response = await fetch(url);
        if (!response.ok) {
            const text = await response.text();
            console.error(`DEBUG: Error response body: ${text}`);  // Added error logging
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        console.error(`DEBUG: Response for ${endpoint}:`, JSON.stringify(data, null, 2));  // Added response logging
        return data as T;
    } catch (error) {
        console.error(`DEBUG: Error in ${endpoint}:`, error);  // Added error detail
        return null;
    }
}

// Get STRING ID for a gene symbol
async function getStringId(geneSymbol: string, species: number = 9606): Promise<string | null> {
    server.sendLoggingMessage({
        level: "info",
        data: `Starting getStringId for gene symbol: ${geneSymbol}, species: ${species}`,
    });

    const response = await makeStringDBRequest<StringIdResponse[]>('get_string_ids', {
        identifiers: geneSymbol,
        species: species
    });

    if (!response || response.length === 0) {
        server.sendLoggingMessage({
            level: "warning",
            data: `No STRING ID found for: ${geneSymbol}`,
        });
        return null;
    }

    server.sendLoggingMessage({
        level: "info",
        data: {
            message: `Found STRING ID for ${geneSymbol}`,
            stringId: response[0].stringId,
            fullResponse: response[0]
        },
    });
    return response[0].stringId;
}

async function getProteinInteractions(params: {
    protein: string,
    species?: number,
    required_score?: number,
    limit?: number
}): Promise<InteractionResponseWithEvidence[] | null> {
    try {
        server.sendLoggingMessage({
            level: "info",
            data: {
                message: "Starting getProteinInteractions",
                params: params
            },
        });
        
        // First get STRING ID
        const stringId = await getStringId(params.protein, params.species);
        
        if (!stringId) {
            server.sendLoggingMessage({
                level: "error",
                data: `Failed to get STRING ID for protein: ${params.protein}`,
            });
            return null;
        }

        // Then get interactions
        try {
            server.sendLoggingMessage({
                level: "info",
                data: `Fetching interactions for STRING ID: ${stringId}`,
            });

            const interactions = await makeStringDBRequest<InteractionResponse[]>('interaction_partners', {
                identifier: stringId,
                required_score: params.required_score || 400,
                limit: params.limit || 50
            });

            if (!interactions) {
                server.sendLoggingMessage({
                    level: "warning",
                    data: `No interactions found for STRING ID: ${stringId}`,
                });
                return null;
            }

            server.sendLoggingMessage({
                level: "info",
                data: {
                    message: `Found ${interactions.length} interactions`,
                    firstInteraction: interactions[0]
                },
            });

            // For each interaction, get detailed evidence including PubMed IDs
            server.sendLoggingMessage({
                level: "info",
                data: "Starting to fetch detailed evidence for each interaction",
            });

            const interactionsWithEvidence = await Promise.all(
                interactions.map(async (interaction) => {
                    try {
                        server.sendLoggingMessage({
                            level: "info",
                            data: `Fetching evidence for interaction between ${interaction.preferredName_A} and ${interaction.preferredName_B}`,
                        });

                        const evidence = await makeStringDBRequest<DetailedEvidence>('interaction_information', {
                            string_ids: `${interaction.stringId_A},${interaction.stringId_B}`,
                            required_score: params.required_score || 400,
                        });
                        
                        server.sendLoggingMessage({
                            level: "info",
                            data: {
                                message: `Got evidence for interaction`,
                                proteins: `${interaction.preferredName_A}-${interaction.preferredName_B}`,
                                evidence: evidence
                            },
                        });

                        return {
                            ...interaction,
                            detailedEvidence: evidence
                        } as InteractionResponseWithEvidence;
                    } catch (error) {
                        console.error(`Error fetching evidence for interaction: ${error}`);
                        return {
                            ...interaction,
                            detailedEvidence: null
                        } as InteractionResponseWithEvidence;
                    }
                })
            );

            server.sendLoggingMessage({
                level: "info",
                data: {
                    message: `Completed fetching all interaction evidence`,
                    totalInteractions: interactionsWithEvidence.length,
                    sampleEvidence: interactionsWithEvidence[0]?.detailedEvidence
                },
            });

            return interactionsWithEvidence;
        } catch (error) {
            console.error(`Error in getProteinInteractions: ${error}`);
            return null;
        }
    } catch (error) {
        console.error(`Error in getProteinInteractions outer block: ${error}`);
        return null;
    }
}
// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "get-protein-interactions",
                description: "Get protein-protein interactions for a target protein",
                inputSchema: {
                    type: "object",
                    properties: {
                        protein: {
                            type: "string",
                            description: "Protein identifier (gene name or STRING ID)",
                        },
                        species: {
                            type: "number",
                            description: "NCBI taxonomy identifier (default: 9606 for human)",
                        },
                        required_score: {
                            type: "number",
                            description: "Minimum required interaction score (0-1000)",
                        },
                        limit: {
                            type: "number",
                            description: "Maximum number of interactions to return",
                        }
                    },
                    required: ["protein"],
                },
            },
            {
                name: "get-pathway-enrichment",
                description: "Get enriched pathways for a set of proteins",
                inputSchema: {
                    type: "object",
                    properties: {
                        proteins: {
                            type: "array",
                            items: {
                                type: "string"
                            },
                            description: "Array of protein identifiers",
                        },
                        species: {
                            type: "number",
                            description: "NCBI taxonomy identifier (default: 9606 for human)",
                        }
                    },
                    required: ["proteins"],
                },
            },
        ],
    };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try {
        // Extract the actual tool name and arguments from the request
        const toolName = request.params.name;
        const toolArgs = request.params.arguments || {};

        if (DEBUG) {
            console.error('Tool request:', { toolName, toolArgs });
        }

        if (toolName === "get-protein-interactions") {
            const { protein, species, required_score, limit } = ProteinInteractionsSchema.parse(toolArgs);
            
            if (DEBUG) {
                console.error('Parsed arguments:', { protein, species, required_score, limit });
            }
        
            const interactionData = await getProteinInteractions({
                protein,
                species,
                required_score,
                limit
            });
        
            if (!interactionData) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "Failed to retrieve interaction data. Please check the server logs for details.",
                        },
                    ],
                };
            }
        
            // Format the interaction data into a knowledge graph
            const formattedResult = formatProteinInteractionsGraph(interactionData, protein);
            
            // Return the formatted result with both text content and graph artifact
            return {
                content: formattedResult.content,
                artifacts: formattedResult.artifacts
            };
        }else if (toolName === "get-pathway-enrichment") {
            const { proteins, species } = PathwayEnrichmentSchema.parse(toolArgs);

            const enrichmentData = await makeStringDBRequest<Array<{
                pathway: string;
                description: string;
                p_value: number;
                genes: string[];
            }>>('enrichment', {
                identifiers: proteins.join(','),
                species: species
            });

            if (!enrichmentData) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "Failed to retrieve pathway enrichment data",
                        },
                    ],
                };
            }

            // Format the pathway enrichment data into a knowledge graph
            const formattedResult = formatPathwayEnrichmentGraph(enrichmentData, proteins);
            
            // Return the formatted result with both text content and graph artifact
            return {
                content: formattedResult.content,
                artifacts: formattedResult.artifacts
            };
        }

        // Default return for unknown tool
        return {
            content: [
                {
                    type: "text",
                    text: `Unknown tool: ${toolName}`,
                },
            ],
        };
    } catch (error) {
        if (error instanceof z.ZodError) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Invalid arguments: ${error.errors
                            .map((e) => `${e.path.join(".")}: ${e.message}`)
                            .join(", ")}`,
                    },
                ],
            };
        }
        
        // Return error message for any other errors
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        return {
            content: [
                {
                    type: "text",
                    text: `Error: ${errorMessage}`,
                },
            ],
        };
    }
});

// Start the server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("STRING-db MCP Server running on stdio");
}

main().catch((error) => {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error("Fatal error in main():", errorMessage);
    process.exit(1);
});