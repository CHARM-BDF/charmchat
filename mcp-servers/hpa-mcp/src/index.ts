import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// =============================================================================
// CONFIGURATION SECTION - Human Protein Atlas API Configuration
// =============================================================================

const API_BASE_URL = "https://www.proteinatlas.org";
const TOOL_NAME = "hpa-mcp";
const SERVICE_NAME = "human-protein-atlas";

// =============================================================================
// SCHEMA DEFINITIONS
// =============================================================================

const GetProteinByEnsemblSchema = z.object({
  ensembl_id: z.string().min(1, "Ensembl ID cannot be empty")
    .regex(/^ENSG\d{11}$/, "Invalid Ensembl ID format. Expected format: ENSG followed by 11 digits"),
});

const GetProteinByGeneSchema = z.object({
  gene_symbol: z.string().min(1, "Gene symbol cannot be empty"),
  include_cancer_prognostics: z.boolean().optional().default(true),
  include_expression_data: z.boolean().optional().default(true),
});

const SearchProteinClassSchema = z.object({
  protein_class: z.string().min(1, "Protein class cannot be empty"),
  max_results: z.number().min(1).max(100).optional().default(20),
});

// =============================================================================
// SERVER SETUP
// =============================================================================

const server = new Server(
  {
    name: SERVICE_NAME,
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      logging: {
        level: "debug"
      }
    },
  }
);

// =============================================================================
// API REQUEST HELPERS
// =============================================================================

async function makeHPARequest(ensemblId: string): Promise<any> {
  try {
    const url = `${API_BASE_URL}/${ensemblId}.json`;
    console.error(`[${SERVICE_NAME}] Fetching HPA data from: ${url}`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': `${TOOL_NAME}/1.0`,
      },
    });

    if (response.status === 404) {
      console.error(`[${SERVICE_NAME}] No HPA data found for ${ensemblId}`);
      return null;
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
    }

    const data = await response.json();
    return data;

  } catch (error) {
    console.error(`[${SERVICE_NAME}] Error making HPA request:`, error);
    return null;
  }
}

// Helper to get Ensembl ID from gene symbol (using NCBI Gene API)
async function getEnsemblIdFromGeneSymbol(geneSymbol: string): Promise<string | null> {
  try {
    // First, search NCBI for the gene
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=gene&term=${encodeURIComponent(geneSymbol)}[Gene Name] AND Homo sapiens[Organism]&retmode=json`;
    const searchResponse = await fetch(searchUrl);
    const searchData = await searchResponse.json();
    
    if (!searchData.esearchresult || !searchData.esearchresult.idlist || searchData.esearchresult.idlist.length === 0) {
      return null;
    }
    
    // Get gene details
    const geneId = searchData.esearchresult.idlist[0];
    const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=gene&id=${geneId}&retmode=json`;
    const summaryResponse = await fetch(summaryUrl);
    const summaryData = await summaryResponse.json();
    
    // Extract Ensembl ID from the summary (this is a simplification - in reality might need more complex parsing)
    // For now, we'll return null and suggest using Ensembl ID directly
    console.error(`[${SERVICE_NAME}] Gene symbol lookup not fully implemented. Please use Ensembl ID directly.`);
    return null;
    
  } catch (error) {
    console.error(`[${SERVICE_NAME}] Error looking up gene symbol:`, error);
    return null;
  }
}

// =============================================================================
// DATA FORMATTING FUNCTIONS
// =============================================================================

function extractTissueExpressionData(hpaData: any): any {
  const tissueExpression: {
    tissueSpecificNTPM: Record<string, string>;
    singleCellTypeNTPM?: Record<string, string>;
    cancerSpecificFPKM?: Record<string, string>;
    generalExpression: Record<string, any>;
    expressionSummary: {
      tissueSpecificity: string;
      tissueDistribution: string;
      cellTypeSpecificity: string;
      cancerSpecificity: string;
    };
  } = {
    tissueSpecificNTPM: {},
    generalExpression: {},
    expressionSummary: {
      tissueSpecificity: hpaData['RNA tissue specificity'] || 'N/A',
      tissueDistribution: hpaData['RNA tissue distribution'] || 'N/A',
      cellTypeSpecificity: hpaData['RNA single cell type specificity'] || 'N/A',
      cancerSpecificity: hpaData['RNA cancer specificity'] || 'N/A'
    }
  };

  // Extract tissue-specific nTPM data (enhanced expression tissues)
  if (hpaData['RNA tissue specific nTPM'] && typeof hpaData['RNA tissue specific nTPM'] === 'object') {
    tissueExpression.tissueSpecificNTPM = hpaData['RNA tissue specific nTPM'];
  }

  // Extract single cell type specific nTPM data
  if (hpaData['RNA single cell type specific nTPM'] && typeof hpaData['RNA single cell type specific nTPM'] === 'object') {
    tissueExpression.singleCellTypeNTPM = hpaData['RNA single cell type specific nTPM'];
  }

  // Extract cancer specific FPKM data
  if (hpaData['RNA cancer specific FPKM'] && typeof hpaData['RNA cancer specific FPKM'] === 'object') {
    tissueExpression.cancerSpecificFPKM = hpaData['RNA cancer specific FPKM'];
  }

  // Look for any other expression-related fields that might contain tissue data
  Object.keys(hpaData).forEach(key => {
    // Look for fields that might contain general tissue expression data
    if (key.toLowerCase().includes('expression') && 
        key.toLowerCase().includes('tissue') && 
        !key.includes('specific') &&
        typeof hpaData[key] === 'object' &&
        hpaData[key] !== null) {
      tissueExpression.generalExpression[key] = hpaData[key];
    }
  });

  return tissueExpression;
}

function formatTissueExpressionSection(tissueData: any): string {
  let markdown = '';

  // Summary section
  markdown += `## Expression Summary\n\n`;
  markdown += `- **Tissue Specificity**: ${tissueData.expressionSummary.tissueSpecificity}\n`;
  markdown += `- **Tissue Distribution**: ${tissueData.expressionSummary.tissueDistribution}\n`;
  markdown += `- **Cell Type Specificity**: ${tissueData.expressionSummary.cellTypeSpecificity}\n`;
  markdown += `- **Cancer Specificity**: ${tissueData.expressionSummary.cancerSpecificity}\n\n`;

  // Tissue-specific enhanced expression
  if (tissueData.tissueSpecificNTPM && Object.keys(tissueData.tissueSpecificNTPM).length > 0) {
    markdown += `## Tissue-Specific Enhanced Expression (nTPM)\n\n`;
    markdown += `The following tissues show enhanced expression compared to other tissues:\n\n`;
    
    // Sort tissues by expression value (highest first)
    const sortedTissues = Object.entries(tissueData.tissueSpecificNTPM)
      .sort(([,a], [,b]) => parseFloat(b as string) - parseFloat(a as string));
    
    markdown += `| Tissue | Expression (nTPM) |\n`;
    markdown += `|--------|------------------|\n`;
    
    for (const [tissue, value] of sortedTissues) {
      markdown += `| ${tissue.charAt(0).toUpperCase() + tissue.slice(1)} | ${value} |\n`;
    }
    markdown += '\n';
  }

  // Single cell type specific expression
  if (tissueData.singleCellTypeNTPM && Object.keys(tissueData.singleCellTypeNTPM).length > 0) {
    markdown += `## Cell Type-Specific Expression (nTPM)\n\n`;
    markdown += `The following cell types show specific expression:\n\n`;
    
    // Sort cell types by expression value (highest first)
    const sortedCellTypes = Object.entries(tissueData.singleCellTypeNTPM)
      .sort(([,a], [,b]) => parseFloat(b as string) - parseFloat(a as string));
    
    markdown += `| Cell Type | Expression (nTPM) |\n`;
    markdown += `|-----------|------------------|\n`;
    
    for (const [cellType, value] of sortedCellTypes) {
      markdown += `| ${cellType} | ${value} |\n`;
    }
    markdown += '\n';
  }

  // Cancer-specific expression
  if (tissueData.cancerSpecificFPKM && Object.keys(tissueData.cancerSpecificFPKM).length > 0) {
    markdown += `## Cancer-Specific Expression (FPKM)\n\n`;
    markdown += `The following cancer types show specific expression:\n\n`;
    
    // Sort cancer types by expression value (highest first)
    const sortedCancers = Object.entries(tissueData.cancerSpecificFPKM)
      .sort(([,a], [,b]) => parseFloat(b as string) - parseFloat(a as string));
    
    markdown += `| Cancer Type | Expression (FPKM) |\n`;
    markdown += `|-------------|------------------|\n`;
    
    for (const [cancer, value] of sortedCancers) {
      markdown += `| ${cancer} | ${value} |\n`;
    }
    markdown += '\n';
  }

  // Additional expression data
  if (tissueData.generalExpression && Object.keys(tissueData.generalExpression).length > 0) {
    markdown += `## Additional Expression Data\n\n`;
    for (const [dataType, values] of Object.entries(tissueData.generalExpression)) {
      if (typeof values === 'object' && values !== null) {
        markdown += `### ${dataType.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}\n\n`;
        markdown += `| Sample/Tissue | Value |\n`;
        markdown += `|---------------|-------|\n`;
        
        for (const [key, value] of Object.entries(values as Record<string, any>)) {
          markdown += `| ${key} | ${value} |\n`;
        }
        markdown += '\n';
      }
    }
  }

  return markdown;
}

function summarizeCancerPrognostics(hpaData: any): any {
  const prognostics = {
    totalCancerTypes: 0,
    prognosticCancers: [] as any[],
    unprognosticCancers: [] as string[],
    favorablePrognosis: [] as string[],
    unfavorablePrognosis: [] as string[]
  };

  Object.keys(hpaData).forEach(key => {
    if (key.startsWith('Cancer prognostics -')) {
      const cancerType = key.replace('Cancer prognostics - ', '').replace(' (TCGA)', '').replace(' (validation)', '');
      const data = hpaData[key];
      
      prognostics.totalCancerTypes++;
      
      if (data.is_prognostic) {
        prognostics.prognosticCancers.push({
          cancer: cancerType,
          type: data['prognostic type'],
          prognostic: data.prognostic,
          pValue: data.p_val
        });
        
        if (data['prognostic type'] === 'favorable') {
          prognostics.favorablePrognosis.push(cancerType);
        } else if (data['prognostic type'] === 'unfavorable') {
          prognostics.unfavorablePrognosis.push(cancerType);
        }
      } else {
        prognostics.unprognosticCancers.push(cancerType);
      }
    }
  });

  return prognostics;
}

function formatProteinDataAsMarkdown(hpaData: any, includeCancer: boolean = true, includeExpression: boolean = true): string {
  let markdown = `# ${hpaData.Gene || 'Unknown Gene'} - Human Protein Atlas\n\n`;
  
  // Basic information
  markdown += `## Basic Information\n\n`;
  markdown += `- **Gene Symbol**: ${hpaData.Gene || 'N/A'}\n`;
  markdown += `- **Description**: ${hpaData['Gene description'] || 'N/A'}\n`;
  markdown += `- **Ensembl ID**: ${hpaData.Ensembl || 'N/A'}\n`;
  markdown += `- **UniProt ID(s)**: ${hpaData.Uniprot ? hpaData.Uniprot.join(', ') : 'N/A'}\n`;
  markdown += `- **Chromosome**: ${hpaData.Chromosome || 'N/A'} (${hpaData.Position || 'N/A'})\n`;
  markdown += `- **Evidence Level**: ${hpaData.Evidence || 'N/A'}\n\n`;
  
  // Protein classification
  if (hpaData['Protein class'] && hpaData['Protein class'].length > 0) {
    markdown += `## Protein Classification\n\n`;
    markdown += `- **Protein Class**: ${hpaData['Protein class'].join(', ')}\n`;
    if (hpaData['Biological process'] && hpaData['Biological process'].length > 0) {
      markdown += `- **Biological Process**: ${hpaData['Biological process'].join(', ')}\n`;
    }
    if (hpaData['Molecular function'] && hpaData['Molecular function'].length > 0) {
      markdown += `- **Molecular Function**: ${hpaData['Molecular function'].join(', ')}\n`;
    }
    markdown += '\n';
  }
  
  // Subcellular localization
  if (hpaData['Subcellular main location'] && hpaData['Subcellular main location'].length > 0) {
    markdown += `## Subcellular Localization\n\n`;
    markdown += `- **Main Location(s)**: ${hpaData['Subcellular main location'].join(', ')}\n`;
    if (hpaData['Subcellular location'] && hpaData['Subcellular location'].length > 0) {
      markdown += `- **Additional Locations**: ${hpaData['Subcellular location'].join(', ')}\n`;
    }
    markdown += '\n';
  }
  
  // Enhanced Expression data section
  if (includeExpression) {
    const tissueData = extractTissueExpressionData(hpaData);
    const expressionSection = formatTissueExpressionSection(tissueData);
    markdown += expressionSection;
  }
  
  // Disease involvement
  if (hpaData['Disease involvement'] && hpaData['Disease involvement'].length > 0) {
    markdown += `## Disease Involvement\n\n`;
    markdown += `**Disease Categories**: ${hpaData['Disease involvement'].join(', ')}\n\n`;
  }
  
  // Cancer prognostics
  if (includeCancer) {
    const prognostics = summarizeCancerPrognostics(hpaData);
    if (prognostics.prognosticCancers.length > 0) {
      markdown += `## Cancer Prognostics\n\n`;
      markdown += `- **Total Cancer Types Analyzed**: ${prognostics.totalCancerTypes}\n`;
      markdown += `- **Prognostic in**: ${prognostics.prognosticCancers.length} cancer type(s)\n\n`;
      
      if (prognostics.unfavorablePrognosis.length > 0) {
        markdown += `### Unfavorable Prognosis\n`;
        prognostics.unfavorablePrognosis.forEach((cancer: string) => {
          markdown += `- ${cancer}\n`;
        });
        markdown += '\n';
      }
      
      if (prognostics.favorablePrognosis.length > 0) {
        markdown += `### Favorable Prognosis\n`;
        prognostics.favorablePrognosis.forEach((cancer: string) => {
          markdown += `- ${cancer}\n`;
        });
        markdown += '\n';
      }
    }
  }
  
  // Additional information
  markdown += `## Additional Information\n\n`;
  markdown += `- **Protein Interactions**: ${hpaData.Interactions || 0}\n`;
  markdown += `- **Available Antibodies**: ${hpaData.Antibody ? hpaData.Antibody.length : 0}\n`;
  
  const bloodIM = hpaData['Blood concentration - Conc. blood IM [pg/L]'];
  const bloodMS = hpaData['Blood concentration - Conc. blood MS [pg/L]'];
  if (bloodIM || bloodMS) {
    markdown += `- **Blood Concentration**: Available\n`;
    if (bloodIM) markdown += `  - Immunoassay: ${bloodIM}\n`;
    if (bloodMS) markdown += `  - Mass Spectrometry: ${bloodMS}\n`;
  }
  
  if (hpaData['Secretome location']) {
    markdown += `- **Secretome Location**: ${hpaData['Secretome location']}\n`;
  }
  
  markdown += `\n---\n\n`;
  markdown += `**Source**: [Human Protein Atlas - ${hpaData.Gene}](${API_BASE_URL}/${hpaData.Ensembl})\n`;
  
  return markdown;
}

function formatProteinSummaryForModel(hpaData: any): string {
  const gene = hpaData.Gene || 'Unknown';
  const description = hpaData['Gene description'] || 'No description available';
  const tissueSpec = hpaData['RNA tissue specificity'] || 'Unknown';
  const disease = hpaData['Disease involvement'] || [];
  
  let summary = `**${gene}**: ${description}\n\n`;
  summary += `**Tissue Expression**: ${tissueSpec}\n`;
  if (disease.length > 0) {
    summary += `**Disease Involvement**: ${disease.join(', ')}\n`;
  }
  
  // Add cancer prognostics summary if available
  const prognostics = summarizeCancerPrognostics(hpaData);
  if (prognostics.prognosticCancers.length > 0) {
    summary += `**Cancer Prognostics**: Prognostic in ${prognostics.prognosticCancers.length} cancer types`;
    if (prognostics.unfavorablePrognosis.length > 0) {
      summary += ` (${prognostics.unfavorablePrognosis.length} unfavorable)`;
    }
    summary += '\n';
  }
  
  return summary;
}

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get-protein-by-ensembl",
        description: "Get Human Protein Atlas data for a protein using its Ensembl ID (e.g., ENSG00000146648)",
        inputSchema: {
          type: "object",
          properties: {
            ensembl_id: {
              type: "string",
              description: "Ensembl gene ID (format: ENSG followed by 11 digits)",
              pattern: "^ENSG\\d{11}$"
            },
          },
          required: ["ensembl_id"],
        },
      },
      {
        name: "get-protein-by-gene",
        description: "Get Human Protein Atlas data for a protein using its gene symbol (e.g., EGFR, TP53)",
        inputSchema: {
          type: "object",
          properties: {
            gene_symbol: {
              type: "string",
              description: "Gene symbol (e.g., EGFR, TP53, BRCA1)",
            },
            include_cancer_prognostics: {
              type: "boolean",
              description: "Include cancer prognostics data in the response",
            },
            include_expression_data: {
              type: "boolean",
              description: "Include expression data in the response",
            },
          },
          required: ["gene_symbol"],
        },
      },
      {
        name: "search-protein-class",
        description: "Search for proteins by protein class (e.g., 'Kinases', 'Transcription factors')",
        inputSchema: {
          type: "object",
          properties: {
            protein_class: {
              type: "string",
              description: "Protein class to search for",
            },
            max_results: {
              type: "number",
              description: "Maximum number of results to return (1-100)",
              minimum: 1,
              maximum: 100,
            },
          },
          required: ["protein_class"],
        },
      },
    ],
  };
});

// =============================================================================
// TOOL EXECUTION
// =============================================================================

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "get-protein-by-ensembl") {
      const { ensembl_id } = GetProteinByEnsemblSchema.parse(args);
      
      console.error(`[${SERVICE_NAME}] Getting protein data for Ensembl ID:`, ensembl_id);
      
      const hpaData = await makeHPARequest(ensembl_id);
      
      if (!hpaData) {
        return {
          content: [
            {
              type: "text",
              text: `No Human Protein Atlas data found for Ensembl ID: ${ensembl_id}`,
            },
          ],
        };
      }

      const markdownContent = formatProteinDataAsMarkdown(hpaData);
      const summary = formatProteinSummaryForModel(hpaData);

      return {
        content: [
          {
            type: "text",
            text: `# Human Protein Atlas Data\n\n${summary}\n\n` +
                  `**Instructions for summarization:** Based on the conversation context, extract and summarize the most relevant protein information. ` +
                  `Focus on aspects that address the user's specific questions about this protein. ` +
                  `If the user is asking about function, localization, expression, or disease relevance, prioritize those sections.`,
            forModel: true
          }
        ],
        artifacts: [
          {
            type: "text/markdown",
            title: `${hpaData.Gene || ensembl_id} - HPA Data`,
            content: markdownContent
          }
        ]
      };

    } else if (name === "get-protein-by-gene") {
      const { gene_symbol, include_cancer_prognostics, include_expression_data } = GetProteinByGeneSchema.parse(args);
      
      console.error(`[${SERVICE_NAME}] Getting protein data for gene symbol:`, gene_symbol);
      
      // For now, return an informative message about needing Ensembl ID
      // In a full implementation, this would do gene symbol lookup
      return {
        content: [
          {
            type: "text",
            text: `To retrieve Human Protein Atlas data for gene ${gene_symbol}, please provide the Ensembl ID. ` +
                  `\n\nYou can find the Ensembl ID by:\n` +
                  `1. Searching for "${gene_symbol}" on https://www.proteinatlas.org\n` +
                  `2. Using a gene database to convert gene symbol to Ensembl ID\n` +
                  `3. The Ensembl ID format is ENSG followed by 11 digits (e.g., ENSG00000146648)\n\n` +
                  `Common genes:\n` +
                  `- EGFR: ENSG00000146648\n` +
                  `- TP53: ENSG00000141510\n` +
                  `- BRCA1: ENSG00000012048\n` +
                  `- KRAS: ENSG00000133703`,
          },
        ],
      };

    } else if (name === "search-protein-class") {
      const { protein_class, max_results } = SearchProteinClassSchema.parse(args);
      
      console.error(`[${SERVICE_NAME}] Searching for protein class:`, protein_class);
      
      // Note: The HPA API doesn't have a direct search endpoint
      // This would require web scraping or using their download files
      return {
        content: [
          {
            type: "text",
            text: `The Human Protein Atlas API does not provide direct search functionality for protein classes.\n\n` +
                  `To search for proteins by class "${protein_class}", you can:\n` +
                  `1. Visit https://www.proteinatlas.org/search/${encodeURIComponent(protein_class)}\n` +
                  `2. Download protein class data from https://www.proteinatlas.org/about/download\n` +
                  `3. Use the Ensembl IDs of specific proteins you're interested in\n\n` +
                  `Common protein classes include:\n` +
                  `- Enzymes\n` +
                  `- Transporters\n` +
                  `- Receptors\n` +
                  `- Transcription factors\n` +
                  `- Kinases\n` +
                  `- Disease related genes\n` +
                  `- FDA approved drug targets`,
          },
        ],
      };
      
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(
        `Invalid arguments: ${error.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")}`
      );
    }
    throw error;
  }
});

// =============================================================================
// SERVER STARTUP
// =============================================================================

async function main() {
  console.log(`[${SERVICE_NAME}] Starting Human Protein Atlas MCP Server`);
  console.log(`[${SERVICE_NAME}] API Base URL: ${API_BASE_URL}`);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log(`[${SERVICE_NAME}] MCP Server running on stdio`);
}

main().catch((error) => {
  console.error(`[${SERVICE_NAME}] Fatal error in main():`, error);
  process.exit(1);
}); 