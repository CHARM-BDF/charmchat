import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// =============================================================================
// CONFIGURATION SECTION - ChEMBL API CONFIGURATION
// =============================================================================

const API_BASE_URL = "https://www.ebi.ac.uk/chembl/api/data";
const TOOL_NAME = "chembl-moa-mcp";
const SERVICE_NAME = "chembl-moa";

// ChEMBL is a public API - no authentication needed
// Optional: Contact email for responsible API usage
const USER_EMAIL = process.env.CHEMBL_USER_EMAIL || 'anonymous@example.com';

// Rate limiting - ChEMBL is public but we should be respectful
const RATE_LIMIT_MS = 200; // 200ms between requests

// =============================================================================
// SCHEMA DEFINITIONS - INPUT VALIDATION SCHEMAS
// =============================================================================

// Schema for searching mechanisms of action
const SearchMechanismsSchema = z.object({
  query: z.string().min(1, "Query cannot be empty"),
  action_type: z.enum(['AGONIST', 'ANTAGONIST', 'INHIBITOR', 'ACTIVATOR', 'MODULATOR', 'BLOCKER']).optional(),
  max_results: z.number().min(1).max(100).optional().default(20),
  include_targets: z.boolean().optional().default(true),
});

// Schema for getting detailed drug information
const GetDrugDetailsSchema = z.object({
  drug_identifier: z.string().min(1, "Drug identifier cannot be empty"),
  include_activities: z.boolean().optional().default(false),
  include_properties: z.boolean().optional().default(true),
});

// Schema for searching targets
const SearchTargetsSchema = z.object({
  target_query: z.string().min(1, "Target query cannot be empty"),
  organism: z.string().optional(),
  target_type: z.enum(['SINGLE_PROTEIN', 'PROTEIN_COMPLEX', 'PROTEIN_FAMILY']).optional(),
  max_results: z.number().min(1).max(50).optional().default(20),
  include_drugs: z.boolean().optional().default(true),
});

// Schema for analyzing drug-target interactions
const AnalyzeInteractionsSchema = z.object({
  drug_id: z.string().min(1, "Drug ID cannot be empty"),
  target_id: z.string().optional(),
  activity_types: z.array(z.string()).optional().default(['IC50', 'Ki', 'EC50', 'Kd']),
  max_activities: z.number().min(1).max(100).optional().default(50),
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
// API REQUEST HELPER - ChEMBL REST API
// =============================================================================

async function makeChEMBLRequest(endpoint: string, params?: Record<string, string>): Promise<any> {
  try {
    // Add rate limiting
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS));

    let url = `${API_BASE_URL}/${endpoint}`;
    
    // Add query parameters if provided
    if (params) {
      const searchParams = new URLSearchParams(params);
      url += `?${searchParams.toString()}`;
    }

    console.error(`[${SERVICE_NAME}] Making request to: ${url}`);

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'User-Agent': `${TOOL_NAME} (${USER_EMAIL})`,
    };

    const response = await fetch(url, {
      method: 'GET',
      headers: headers,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
    }

    const data = await response.json();
    return data;

  } catch (error) {
    console.error(`Error making ChEMBL request to ${endpoint}:`, error);
    return null;
  }
}

// =============================================================================
// DATA FORMATTING FUNCTIONS
// =============================================================================

// Format mechanism of action data for display
function formatMechanismForModel(mechanism: any): string {
  const drug_name = mechanism.molecule_chembl_id || "Unknown";
  const target_name = mechanism.target_chembl_id || "Unknown";
  const action = mechanism.mechanism_of_action || "Unknown mechanism";
  const action_type = mechanism.action_type || "Unknown";
  const references = mechanism.mechanism_refs?.map((ref: any) => ref.ref_url).join(", ") || "No references";

  return [
    `**Drug**: ${drug_name}`,
    `**Target**: ${target_name}`,
    `**Mechanism**: ${action}`,
    `**Action Type**: ${action_type}`,
    `**References**: ${references}`,
    "---"
  ].filter(Boolean).join("\n");
}

// Format drug details for display
function formatDrugForModel(drug: any): string {
  const name = drug.pref_name || drug.molecule_chembl_id || "Unknown";
  const max_phase = drug.max_phase !== null ? `Phase ${drug.max_phase}` : "Preclinical";
  const mw = drug.molecule_properties?.full_mwt ? `${drug.molecule_properties.full_mwt} Da` : "Unknown";
  const formula = drug.molecule_properties?.full_molformula || "Unknown";
  const synonyms = drug.molecule_synonyms?.slice(0, 3).map((syn: any) => syn.molecule_synonym).join(", ") || "None";

  return [
    `**Name**: ${name}`,
    `**ChEMBL ID**: ${drug.molecule_chembl_id}`,
    `**Max Phase**: ${max_phase}`,
    `**Molecular Weight**: ${mw}`,
    `**Formula**: ${formula}`,
    `**Synonyms**: ${synonyms}`,
    "---"
  ].filter(Boolean).join("\n");
}

// Format target data for display
function formatTargetForModel(target: any): string {
  const name = target.pref_name || "Unknown";
  const organism = target.organism || "Unknown";
  const target_type = target.target_type || "Unknown";
  const chembl_id = target.target_chembl_id || "Unknown";
  
  // Get component information if available
  const components = target.target_components || [];
  const mainComponent = components[0];
  const accession = mainComponent?.accession || "";
  const description = mainComponent?.component_description || "";
  
  // Get synonyms if available
  const synonyms = mainComponent?.target_component_synonyms
    ?.filter((syn: any) => syn.syn_type === "GENE_SYMBOL")
    ?.map((syn: any) => syn.component_synonym)
    ?.slice(0, 3)
    ?.join(", ") || "";

  // Format type with emoji
  const typeIcon = target_type === "SINGLE PROTEIN" ? "🧬" :
                   target_type === "PROTEIN COMPLEX" ? "🔗" :
                   target_type === "CHIMERIC PROTEIN" ? "🧪" :
                   target_type === "PROTEIN-PROTEIN INTERACTION" ? "🤝" :
                   target_type === "PROTEIN FAMILY" ? "👥" : "🎯";

  const parts = [
    `## ${typeIcon} ${name}`,
    "",
    `**🆔 ChEMBL ID:** \`${chembl_id}\``,
    `**🔬 Type:** ${target_type}`,
    `**🧬 Organism:** *${organism}*`
  ];

  if (accession) {
    parts.push(`**📋 UniProt:** \`${accession}\``);
  }
  
  if (description && description !== name) {
    parts.push(`**📝 Description:** ${description}`);
  }
  
  if (synonyms) {
    parts.push(`**🏷️ Gene Symbols:** ${synonyms}`);
  }
  
  if (components.length > 1) {
    parts.push(`**🧩 Components:** ${components.length} proteins`);
  }

  parts.push("", "---");
  
  return parts.filter(Boolean).join("\n");
}

// Create user-friendly artifact for target search results
function createTargetSearchArtifact(query: string, targets: any[]): string {
  const timestamp = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  const sections = [
    `# 🎯 ChEMBL Target Search Report`,
    ``,
    `**Search Query:** "${query}"`,
    `**Search Date:** ${timestamp}`,
    `**Total Results:** ${targets.length} target(s)`,
    `**Database:** ChEMBL (European Bioinformatics Institute)`,
    ``,
    `---`,
    ``
  ];

  if (targets.length === 0) {
    sections.push(
      `## ❌ No Results Found`,
      ``,
      `No targets were found matching your query "${query}".`,
      ``,
      `### 💡 Search Tips:`,
      `- Try using partial gene names (e.g., "EGF" instead of "EGFR")`,
      `- Use common protein names or abbreviations`,
      `- Check spelling and try alternative names`,
      `- Consider broader search terms`,
      ``
    );
  } else {
    sections.push(
      `## 📊 Search Summary`,
      ``
    );

    // Group targets by type for summary
    const typeGroups: { [key: string]: number } = {};
    targets.forEach(target => {
      const type = target.target_type || "Unknown";
      typeGroups[type] = (typeGroups[type] || 0) + 1;
    });

    Object.entries(typeGroups).forEach(([type, count]) => {
      const icon = type === "SINGLE PROTEIN" ? "🧬" :
                   type === "PROTEIN COMPLEX" ? "🔗" :
                   type === "CHIMERIC PROTEIN" ? "🧪" :
                   type === "PROTEIN-PROTEIN INTERACTION" ? "🤝" :
                   type === "PROTEIN FAMILY" ? "👥" : "🎯";
      sections.push(`- ${icon} **${type}**: ${count} target(s)`);
    });

    sections.push(``, `---`, ``, `## 🧬 Detailed Target Information`, ``);

    // Add detailed target information
    targets.forEach((target, index) => {
      const name = target.pref_name || "Unknown";
      const organism = target.organism || "Unknown";
      const target_type = target.target_type || "Unknown";
      const chembl_id = target.target_chembl_id || "Unknown";
      
      const components = target.target_components || [];
      const mainComponent = components[0];
      const accession = mainComponent?.accession || "";
      const description = mainComponent?.component_description || "";
      
      const synonyms = mainComponent?.target_component_synonyms
        ?.filter((syn: any) => syn.syn_type === "GENE_SYMBOL")
        ?.map((syn: any) => syn.component_synonym)
        ?.slice(0, 5)
        ?.join(", ") || "";

      const typeIcon = target_type === "SINGLE PROTEIN" ? "🧬" :
                       target_type === "PROTEIN COMPLEX" ? "🔗" :
                       target_type === "CHIMERIC PROTEIN" ? "🧪" :
                       target_type === "PROTEIN-PROTEIN INTERACTION" ? "🤝" :
                       target_type === "PROTEIN FAMILY" ? "👥" : "🎯";

      sections.push(
        `### ${index + 1}. ${typeIcon} ${name}`,
        ``,
        `| Field | Value |`,
        `|-------|-------|`,
        `| **ChEMBL ID** | \`${chembl_id}\` |`,
        `| **Target Type** | ${target_type} |`,
        `| **Organism** | *${organism}* |`
      );

      if (accession) {
        sections.push(`| **UniProt ID** | [\`${accession}\`](https://www.uniprot.org/uniprotkb/${accession}) |`);
      }

      if (description && description !== name) {
        sections.push(`| **Description** | ${description} |`);
      }

      if (synonyms) {
        sections.push(`| **Gene Symbols** | ${synonyms} |`);
      }

      if (components.length > 1) {
        sections.push(`| **Components** | ${components.length} protein components |`);
      }

      sections.push(``, `**🔗 External Links:**`);
      sections.push(`- [ChEMBL Target Page](https://www.ebi.ac.uk/chembl/target_report_card/${chembl_id}/)`);
      if (accession) {
        sections.push(`- [UniProt Entry](https://www.uniprot.org/uniprotkb/${accession})`);
      }

      sections.push(``, `---`, ``);
    });

    sections.push(
      `## 📚 About This Data`,
      ``,
      `This search was performed against the **ChEMBL database**, a manually curated database of bioactive molecules with drug-like properties maintained by the European Bioinformatics Institute (EBI).`,
      ``,
      `### 🔍 Search Coverage:`,
      `- Target names and preferred names`,
      `- Gene symbols and synonyms`,
      `- Protein descriptions`,
      `- UniProt cross-references`,
      ``,
      `### 📈 Target Types Explained:`,
      `- **🧬 Single Protein**: Individual protein targets`,
      `- **🔗 Protein Complex**: Multi-protein assemblies`,
      `- **🧪 Chimeric Protein**: Engineered fusion proteins`,
      `- **🤝 Protein-Protein Interaction**: Binding interfaces`,
      `- **👥 Protein Family**: Groups of related proteins`,
      ``
    );
  }

  return sections.join('\n');
}

// Create user-friendly artifact for drugs targeting a gene
function createDrugTargetingArtifact(query: string, drugsForTargets: any[]): string {
  const timestamp = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  const sections = [
    `# 💊 Drugs Targeting Gene: ${query}`,
    ``,
    `**Gene/Protein Query:** "${query}"`,
    `**Search Date:** ${timestamp}`,
    `**Targets Found:** ${drugsForTargets.length}`,
    `**Database:** ChEMBL (European Bioinformatics Institute)`,
    ``,
    `---`,
    ``,
    `## 📊 Summary`,
    ``
  ];

  // Calculate total drugs across all targets
  let totalDrugs = 0;
  const mechanismTypes: { [key: string]: number } = {};
  
  drugsForTargets.forEach(targetData => {
    targetData.mechanisms.forEach((mech: any) => {
      totalDrugs++;
      const actionType = mech.action_type || "Unknown";
      mechanismTypes[actionType] = (mechanismTypes[actionType] || 0) + 1;
    });
  });

  sections.push(`**Total Drugs Found:** ${totalDrugs}`);
  sections.push(`**Targets with Drugs:** ${drugsForTargets.length}`);
  sections.push(``);

  if (Object.keys(mechanismTypes).length > 0) {
    sections.push(`**Mechanism Types:**`);
    Object.entries(mechanismTypes).forEach(([type, count]) => {
      const icon = type === "INHIBITOR" ? "🚫" :
                   type === "AGONIST" ? "🔋" :
                   type === "ANTAGONIST" ? "⛔" :
                   type === "MODULATOR" ? "🎛️" : "💊";
      sections.push(`- ${icon} **${type}**: ${count} drug(s)`);
    });
    sections.push(``);
  }

  sections.push(`---`, ``, `## 🎯 Drugs by Target`, ``);

  // Detailed drug information by target
  drugsForTargets.forEach((targetData, targetIndex) => {
    const target = targetData.target;
    const mechanisms = targetData.mechanisms;
    const targetName = target.pref_name || "Unknown Target";
    const targetId = target.target_chembl_id;

    sections.push(`### ${targetIndex + 1}. ${targetName}`);
    sections.push(``);
    sections.push(`**Target ID:** \`${targetId}\``);
    sections.push(`**Drug Count:** ${mechanisms.length}`);
    sections.push(``);

    if (mechanisms.length === 0) {
      sections.push(`*No drugs found for this target.*`);
    } else {
      sections.push(`| Drug ID | Mechanism of Action | Action Type | References |`);
      sections.push(`|---------|-------------------|-------------|------------|`);
      
      mechanisms.forEach((mech: any) => {
        const drugId = mech.molecule_chembl_id || "Unknown";
        const action = mech.mechanism_of_action || "Unknown mechanism";
        const actionType = mech.action_type || "Unknown";
        const refCount = mech.mechanism_refs?.length || 0;
        const refText = refCount > 0 ? `${refCount} ref(s)` : "No refs";
        
        sections.push(`| [\`${drugId}\`](https://www.ebi.ac.uk/chembl/compound_report_card/${drugId}/) | ${action} | ${actionType} | ${refText} |`);
      });
    }

    sections.push(``);

    // Add external links
    sections.push(`**🔗 External Links:**`);
    sections.push(`- [ChEMBL Target Page](https://www.ebi.ac.uk/chembl/target_report_card/${targetId}/)`);
    if (target.target_components?.[0]?.accession) {
      const accession = target.target_components[0].accession;
      sections.push(`- [UniProt Entry](https://www.uniprot.org/uniprotkb/${accession})`);
    }
    sections.push(``);
    sections.push(`---`, ``);
  });

  sections.push(
    `## 📚 Drug Discovery Insights`,
    ``,
    `### 🎯 Target Druggability`,
    `This search found **${totalDrugs} drugs** across **${drugsForTargets.length} target(s)** for the query "${query}". `,
    drugsForTargets.length > 0 ? `This suggests the gene/protein is **druggable** and of therapeutic interest.` : ``,
    ``,
    `### 🔬 Mechanism Diversity`,
    Object.keys(mechanismTypes).length > 1 ? 
      `Multiple mechanism types were found, indicating diverse therapeutic approaches are possible.` :
      `Drugs primarily work through one mechanism type, suggesting a focused therapeutic approach.`,
    ``,
    `### 💡 Research Applications`,
    `- **Drug Repurposing**: Existing drugs may be repurposed for new indications`,
    `- **Target Validation**: Multiple drugs suggest validated therapeutic target`,
    `- **Mechanism Study**: Compare different approaches to modulating this target`,
    `- **Lead Optimization**: Analyze structure-activity relationships across drugs`,
    ``,
    `### 📖 About This Data`,
    ``,
    `This analysis is based on the **ChEMBL database**, which contains manually curated bioactive molecules with drug-like properties. The data represents known drug-target relationships from scientific literature and clinical trials.`,
    ``,
    `**Data Coverage:**`,
    `- Approved drugs and experimental compounds`,
    `- Mechanism of action annotations`,
    `- Literature references and evidence`,
    `- Target validation data`,
    ``
  );

  return sections.join('\n');
}

// Format activity data for display
function formatActivityForModel(activity: any): string {
  const compound = activity.molecule_chembl_id || "Unknown";
  const target = activity.target_chembl_id || "Unknown";
  const activity_type = activity.standard_type || "Unknown";
  const value = activity.standard_value || "Unknown";
  const units = activity.standard_units || "";
  const relation = activity.standard_relation || "";

  return [
    `**Compound**: ${compound}`,
    `**Target**: ${target}`,
    `**Activity**: ${activity_type}`,
    `**Value**: ${relation}${value} ${units}`,
    "---"
  ].filter(Boolean).join("\n");
}



// =============================================================================
// QUERY HELPER FUNCTIONS
// =============================================================================

// Build search parameters for ChEMBL API
function buildMechanismParams(searchParams: any): Record<string, string> {
  const params: Record<string, string> = {
    format: 'json',
    limit: searchParams.max_results.toString()
  };

  // Search by mechanism of action text
  if (searchParams.query) {
    params['mechanism_of_action__icontains'] = searchParams.query;
  }

  // Filter by action type
  if (searchParams.action_type) {
    params['action_type'] = searchParams.action_type;
  }

  return params;
}

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search-mechanisms",
        description: "Search ChEMBL for drug mechanisms of action. " +
          "Find how drugs work, their targets, and action types (agonist, antagonist, inhibitor, etc.). " +
          "Returns mechanism details with drug-target relationships and references.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query for drug name, target name, or mechanism description (e.g., 'kinase inhibitor', 'EGFR', 'aspirin')",
            },
            action_type: {
              type: "string",
              enum: ["AGONIST", "ANTAGONIST", "INHIBITOR", "ACTIVATOR", "MODULATOR", "BLOCKER"],
              description: "Filter by specific action type",
            },
            max_results: {
              type: "number",
              description: "Maximum number of results to return (1-100)",
              minimum: 1,
              maximum: 100,
            },
            include_targets: {
              type: "boolean",
              description: "Include detailed target information in results",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "get-drug-details",
        description: "Get comprehensive information about a specific drug including all mechanisms of action, " +
          "chemical properties, and bioactivity data. Accepts drug names or ChEMBL IDs.",
        inputSchema: {
          type: "object",
          properties: {
            drug_identifier: {
              type: "string",
              description: "Drug name (e.g., 'aspirin', 'ibuprofen') or ChEMBL ID (e.g., 'CHEMBL25')",
            },
            include_activities: {
              type: "boolean",
              description: "Include bioactivity data (IC50, Ki values, etc.)",
            },
            include_properties: {
              type: "boolean", 
              description: "Include chemical properties (molecular weight, formula, etc.)",
            },
          },
          required: ["drug_identifier"],
        },
      },
      {
        name: "search-targets",
        description: "Search for protein targets and find drugs that target them. " +
          "Given a gene symbol or protein name, returns both the target information AND the drugs that target those proteins. " +
          "Perfect for drug discovery research starting from a gene of interest.",
        inputSchema: {
          type: "object",
          properties: {
            target_query: {
              type: "string",
              description: "Target search query: protein name, gene symbol, or pathway (e.g., 'EGFR', 'kinase', 'GPCR')",
            },
            organism: {
              type: "string",
              description: "Filter by organism (e.g., 'Homo sapiens', 'Mus musculus')",
            },
            target_type: {
              type: "string",
              enum: ["SINGLE_PROTEIN", "PROTEIN_COMPLEX", "PROTEIN_FAMILY"],
              description: "Filter by target type",
            },
            max_results: {
              type: "number",
              description: "Maximum number of results to return (1-50)",
              minimum: 1,
              maximum: 50,
            },
            include_drugs: {
              type: "boolean",
              description: "Also find drugs that target the found proteins (default: true)",
            },
          },
          required: ["target_query"],
        },
      },
      {
        name: "analyze-interactions",
        description: "Analyze drug-target interactions with detailed bioactivity data. " +
          "Get potency measurements (IC50, Ki, EC50) for specific drug-target pairs.",
        inputSchema: {
          type: "object",
          properties: {
            drug_id: {
              type: "string",
              description: "ChEMBL drug ID (e.g., 'CHEMBL25' for aspirin)",
            },
            target_id: {
              type: "string",
              description: "ChEMBL target ID (optional - if not provided, analyzes all targets for the drug)",
            },
            activity_types: {
              type: "array",
              items: { type: "string" },
              description: "Activity types to include (e.g., ['IC50', 'Ki', 'EC50', 'Kd'])",
            },
            max_activities: {
              type: "number",
              description: "Maximum number of activity records to return",
              minimum: 1,
              maximum: 100,
            },
          },
          required: ["drug_id"],
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
    if (name === "search-mechanisms") {
      const searchParams = SearchMechanismsSchema.parse(args);
      console.error(`[${SERVICE_NAME}] Searching mechanisms with:`, JSON.stringify(searchParams));
      
      // Build search parameters
      const params = buildMechanismParams(searchParams);
      
      // Search mechanisms
      const mechanismData = await makeChEMBLRequest("mechanism.json", params);
      
      if (!mechanismData || !mechanismData.mechanisms) {
        return {
          content: [
            {
              type: "text",
              text: "Failed to retrieve mechanism data from ChEMBL API",
            },
          ],
        };
      }

      const mechanisms = mechanismData.mechanisms;
      
      if (mechanisms.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No mechanisms found for query: "${searchParams.query}"`,
            },
          ],
        };
      }

      console.log(`[DEBUG] Found ${mechanisms.length} mechanisms`);
      
      // Format results
      const formattedMechanisms = mechanisms.map(formatMechanismForModel);

      return {
        content: [
          {
            type: "text",
            text: `# ChEMBL Mechanism of Action Results: ${searchParams.query}\n\nFound ${mechanisms.length} mechanism(s):\n\n${formattedMechanisms.join("\n\n")}`,
          }
        ],
        artifacts: [
          {
            type: "text/markdown",
            title: "Mechanism of Action Data",
            content: `# ChEMBL Mechanism of Action Results: ${searchParams.query}\n\nFound ${mechanisms.length} mechanism(s):\n\n${formattedMechanisms.join("\n\n")}`
          }
        ]
      };

    } else if (name === "get-drug-details") {
      const { drug_identifier, include_activities, include_properties } = GetDrugDetailsSchema.parse(args);
      
      // Search for the drug first
      let drugData;
      if (drug_identifier.startsWith('CHEMBL')) {
        // Direct ChEMBL ID lookup
        drugData = await makeChEMBLRequest(`molecule/${drug_identifier}.json`);
      } else {
        // Search by name
        const searchData = await makeChEMBLRequest("molecule.json", {
          pref_name__icontains: drug_identifier,
          limit: "1"
        });
        drugData = searchData?.molecules?.[0] ? { [drug_identifier]: searchData.molecules[0] } : null;
      }

      if (!drugData) {
        return {
          content: [
            {
              type: "text",
              text: `No drug found for identifier: "${drug_identifier}"`,
            },
          ],
        };
      }

      const drug = Object.values(drugData)[0] as any;
      const chembl_id = drug.molecule_chembl_id;

      // Get mechanisms for this drug
      const mechanismData = await makeChEMBLRequest("mechanism.json", {
        molecule_chembl_id: chembl_id,
        limit: "20"
      });

      // Get activities if requested
      let activities = [];
      if (include_activities) {
        const activityData = await makeChEMBLRequest("activity.json", {
          molecule_chembl_id: chembl_id,
          limit: "50"
        });
        activities = activityData?.activities || [];
      }

      // Format results
      const formattedDrug = formatDrugForModel(drug);
      const mechanisms = mechanismData?.mechanisms || [];
      const formattedMechanisms = mechanisms.map(formatMechanismForModel);

      let responseText = `# Drug Details: ${drug.pref_name || chembl_id}\n\n${formattedDrug}\n\n`;
      
      if (mechanisms.length > 0) {
        responseText += `## Mechanisms of Action (${mechanisms.length})\n\n${formattedMechanisms.join("\n\n")}\n\n`;
      }

      if (include_activities && activities.length > 0) {
        const formattedActivities = activities.slice(0, 10).map(formatActivityForModel);
        responseText += `## Recent Bioactivities (showing 10 of ${activities.length})\n\n${formattedActivities.join("\n\n")}`;
      }

      return {
        content: [
          {
            type: "text",
            text: responseText,
          }
        ],
        artifacts: [
          {
            type: "text/markdown",
            title: "Complete Drug Profile",
            content: responseText
          }
        ]
      };

    } else if (name === "search-targets") {
      const searchParams = SearchTargetsSchema.parse(args);
      
      const params: Record<string, string> = {
        pref_name__icontains: searchParams.target_query,
        limit: searchParams.max_results.toString(),
        format: 'json'
      };

      if (searchParams.organism) {
        params['organism__icontains'] = searchParams.organism;
      }

      if (searchParams.target_type) {
        params['target_type'] = searchParams.target_type;
      }

      const targetData = await makeChEMBLRequest("target.json", params);
      
      if (!targetData || !targetData.targets) {
        return {
          content: [
            {
              type: "text",
              text: "Failed to retrieve target data from ChEMBL API",
            },
          ],
        };
      }

      let targets = targetData.targets;

      // PRIORITY FIX: When searching by gene symbol (short queries like "EGFR"), 
      // also search for single proteins by full name and prioritize them
      if (searchParams.target_query.length <= 6 && searchParams.target_query.match(/^[A-Z0-9]+$/)) {
        console.log(`[DEBUG] Gene symbol search detected: "${searchParams.target_query}"`);
        
        // Try additional search for single proteins with expanded gene names
        const geneExpansions: Record<string, string> = {
          'EGFR': 'Epidermal growth factor receptor',
          'VEGFR': 'Vascular endothelial growth factor receptor',
          'PDGFR': 'Platelet-derived growth factor receptor',
          'FGFR': 'Fibroblast growth factor receptor',
          'IGF1R': 'Insulin-like growth factor 1 receptor',
          'ERBB': 'Receptor tyrosine-protein kinase erbB'
        };
        
        const expandedName = geneExpansions[searchParams.target_query.toUpperCase()];
        if (expandedName) {
          console.log(`[DEBUG] Trying expanded search for: "${expandedName}"`);
          const expandedParams = {
            pref_name__icontains: expandedName,
            target_type: 'SINGLE PROTEIN',
            limit: "5",
            format: 'json'
          };
          
          try {
            const expandedData = await makeChEMBLRequest("target.json", expandedParams);
            if (expandedData?.targets && expandedData.targets.length > 0) {
              console.log(`[DEBUG] Found ${expandedData.targets.length} single proteins with expanded search`);
              // Prepend the single proteins found by expanded search
              targets = [...expandedData.targets, ...targets];
            }
          } catch (error) {
            console.log(`[DEBUG] Expanded search failed: ${error}`);
          }
        }
        
        // Reorder to prioritize single proteins
        const singleProteins = targets.filter((t: any) => t.target_type === "SINGLE PROTEIN");
        const otherTargets = targets.filter((t: any) => t.target_type !== "SINGLE PROTEIN");
        targets = [...singleProteins, ...otherTargets];
        console.log(`[DEBUG] Final target priority: ${singleProteins.length} single proteins, ${otherTargets.length} other targets`);
      }
      
      if (targets.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No targets found for query: "${searchParams.target_query}"`,
            },
          ],
        };
      }

      const formattedTargets = targets.map(formatTargetForModel);

      // Also find drugs that target these proteins
      let drugsForTargets: any[] = [];
      if (searchParams.include_drugs !== false) {
        for (const target of targets.slice(0, 3)) { // Limit to first 3 targets to avoid too many API calls
          try {
            await new Promise(resolve => setTimeout(resolve, 200)); // Rate limiting
            const mechanismParams = {
              target_chembl_id: target.target_chembl_id,
              limit: "10",
              format: "json"
            };
            const mechanismData = await makeChEMBLRequest("mechanism.json", mechanismParams);
            if (mechanismData?.mechanisms) {
              drugsForTargets.push({
                target: target,
                mechanisms: mechanismData.mechanisms
              });
            }
          } catch (error) {
            console.log(`[DEBUG] Failed to get mechanisms for target ${target.target_chembl_id}`);
          }
        }
      }

      // Format the response text
      let responseText = `# 🎯 ChEMBL Target Search Results\n\n**Query:** "${searchParams.target_query}"\n**Results:** Found ${targets.length} target(s)\n\n---\n\n${formattedTargets.join("\n")}`;
      
      if (drugsForTargets.length > 0) {
        responseText += `\n\n# 💊 Drugs Targeting These Proteins\n\n`;
        drugsForTargets.forEach((targetDrugs, index) => {
          const targetName = targetDrugs.target.pref_name || "Unknown";
          const mechanisms = targetDrugs.mechanisms;
          responseText += `## ${targetName}\n\n`;
          if (mechanisms.length === 0) {
            responseText += `*No known drugs found in ChEMBL*\n\n`;
          } else {
            mechanisms.slice(0, 5).forEach((mech: any) => {
              const drugName = mech.molecule_chembl_id || "Unknown";
              const action = mech.mechanism_of_action || "Unknown mechanism";
              const actionType = mech.action_type || "Unknown";
              responseText += `- **${drugName}**: ${action} (${actionType})\n`;
            });
            if (mechanisms.length > 5) {
              responseText += `- *...and ${mechanisms.length - 5} more drugs*\n`;
            }
            responseText += `\n`;
          }
        });
      }

      return {
        content: [
          {
            type: "text",
            text: responseText,
          }
        ],
        artifacts: [
          {
            type: "text/markdown",
            title: "Target Search Results", 
            content: createTargetSearchArtifact(searchParams.target_query, targets)
          },
          ...(drugsForTargets.length > 0 ? [{
            type: "text/markdown",
            title: "Drugs Targeting Gene",
            content: createDrugTargetingArtifact(searchParams.target_query, drugsForTargets)
          }] : [])
        ]
      };

    } else if (name === "analyze-interactions") {
      const analysisParams = AnalyzeInteractionsSchema.parse(args);
      
      // Build activity search parameters
      const activityParams: Record<string, string> = {
        molecule_chembl_id: analysisParams.drug_id,
        limit: analysisParams.max_activities.toString(),
        format: 'json'
      };

      if (analysisParams.target_id) {
        activityParams['target_chembl_id'] = analysisParams.target_id;
      }

      // Filter by activity types
      if (analysisParams.activity_types.length > 0) {
        activityParams['standard_type__in'] = analysisParams.activity_types.join(',');
      }

      const activityData = await makeChEMBLRequest("activity.json", activityParams);
      
      if (!activityData || !activityData.activities) {
        return {
          content: [
            {
              type: "text",
              text: "Failed to retrieve activity data from ChEMBL API",
            },
          ],
        };
      }

      const activities = activityData.activities;
      
      if (activities.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No bioactivity data found for drug: ${analysisParams.drug_id}`,
            },
          ],
        };
      }

      const formattedActivities = activities.map(formatActivityForModel);

      // Create summary statistics
      const activitySummary = activities.reduce((acc: any, activity: any) => {
        const type = activity.standard_type;
        if (!acc[type]) acc[type] = [];
        if (activity.standard_value) {
          acc[type].push(parseFloat(activity.standard_value));
        }
        return acc;
      }, {});

      let summaryText = "## Activity Summary\n\n";
      for (const [type, values] of Object.entries(activitySummary)) {
        const vals = values as number[];
        if (vals.length > 0) {
          const min = Math.min(...vals);
          const max = Math.max(...vals);
          const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
          summaryText += `**${type}**: ${vals.length} measurements, Range: ${min.toExponential(2)} - ${max.toExponential(2)}, Average: ${avg.toExponential(2)}\n\n`;
        }
      }

      return {
        content: [
          {
            type: "text",
            text: `# Drug-Target Interaction Analysis: ${analysisParams.drug_id}\n\n${summaryText}\n## Individual Activities (${activities.length})\n\n${formattedActivities.join("\n\n")}`,
          }
        ],
        artifacts: [
          {
            type: "text/markdown",
            title: "Bioactivity Analysis",
            content: `# Drug-Target Interaction Analysis: ${analysisParams.drug_id}\n\n${summaryText}\n## Individual Activities (${activities.length})\n\n${formattedActivities.join("\n\n")}`
          }
        ]
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
  console.log(`[${SERVICE_NAME}] ChEMBL Mechanism of Action MCP Server starting...`);
  console.log(`[${SERVICE_NAME}] API Base URL: ${API_BASE_URL}`);
  console.log(`[${SERVICE_NAME}] User Email: ${USER_EMAIL}`);
  console.log(`[${SERVICE_NAME}] Rate Limit: ${RATE_LIMIT_MS}ms between requests`);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log(`[${SERVICE_NAME}] ChEMBL MCP Server running on stdio`);
}

main().catch((error) => {
  console.error(`[${SERVICE_NAME}] Fatal error in main():`, error);
  process.exit(1);
}); 