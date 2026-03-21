import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// =============================================================================
// CONFIGURATION SECTION - ClinicalTrials.gov API
// =============================================================================

const API_BASE_URL = "https://clinicaltrials.gov/api/v2/studies";
const TOOL_NAME = "clinicaltrials-gov-mcp";
const SERVICE_NAME = "clinicaltrials-gov";

// ClinicalTrials.gov API is public and doesn't require authentication
// No API key needed

// =============================================================================
// SCHEMA DEFINITIONS
// =============================================================================

const SearchTrialsArgumentsSchema = z.object({
  condition: z.string().optional(),
  intervention: z.string().optional(),
  other_terms: z.string().optional(),
  skip_validation: z.boolean().optional().default(false),
  max_results: z.number().min(1).max(100).optional().default(50),
}).refine(
  (data) => data.condition || data.intervention || data.other_terms,
  {
    message: "At least one of condition, intervention, or other_terms must be provided",
  }
);

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
// API REQUEST HELPER
// =============================================================================

async function makeAPIRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
  try {
    const url = `${API_BASE_URL}?${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': TOOL_NAME,
    };

    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
    }

    const data = await response.json();
    return data;

  } catch (error) {
    console.error(`Error making API request to ${endpoint}:`, error);
    return null;
  }
}

// Autocomplete API endpoint (internal API used by ClinicalTrials.gov website)
const AUTOCOMPLETE_API_URL = "https://clinicaltrials.gov/api/int/suggest";

async function getAutocompleteSuggestions(input: string, dictionary: string): Promise<string[]> {
  try {
    const url = `${AUTOCOMPLETE_API_URL}?input=${encodeURIComponent(input)}&dictionary=${encodeURIComponent(dictionary)}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': TOOL_NAME,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`Autocomplete API error: ${response.status} - ${response.statusText}`);
      return [];
    }

    const suggestions = await response.json();
    return Array.isArray(suggestions) ? suggestions : [];
  } catch (error) {
    console.error(`Error fetching autocomplete suggestions:`, error);
    return [];
  }
}

async function validateTerm(
  term: string, 
  dictionary: string
): Promise<{exactMatch: boolean, suggestions: string[], matchedTerm: string | null}> {
  const suggestions = await getAutocompleteSuggestions(term, dictionary);
  
  if (suggestions.length === 0) {
    return {
      exactMatch: false,
      suggestions: [],
      matchedTerm: null,
    };
  }

  // Case-insensitive exact match check
  const termLower = term.toLowerCase().trim();
  const matchedSuggestion = suggestions.find(s => s.toLowerCase().trim() === termLower);

  return {
    exactMatch: matchedSuggestion !== undefined,
    suggestions: suggestions,
    matchedTerm: matchedSuggestion || null,
  };
}

// =============================================================================
// DATA FORMATTING FUNCTIONS
// =============================================================================

function extractDosingInfo(study: any): string {
  const proto = study.protocolSection;
  const armsInterventions = proto?.armsInterventionsModule;
  const desc = proto?.descriptionModule;
  
  let dosingInfo = "";
  
  // Extract from interventions
  if (armsInterventions?.interventions) {
    for (const intervention of armsInterventions.interventions) {
      const name = intervention.name || "";
      if (name.toLowerCase().includes("acetylcysteine") || 
          name.toUpperCase().includes("NAC") ||
          name.toLowerCase().includes("n-acetyl")) {
        if (intervention.description) {
          dosingInfo += `**Intervention:** ${name}\n`;
          dosingInfo += `**Description:** ${intervention.description}\n`;
          if (intervention.otherNames && intervention.otherNames.length > 0) {
            dosingInfo += `**Other Names:** ${intervention.otherNames.join(", ")}\n`;
          }
          dosingInfo += "\n";
        }
      }
    }
  }
  
  // Extract from description text
  const briefSummary = desc?.briefSummary || "";
  const detailedDesc = desc?.detailedDescription || "";
  const combinedText = briefSummary + " " + detailedDesc;
  
  // Look for dosing patterns
  const dosingPatterns = [
    /(\d+\s*(?:mg|mg\/kg|mg\/kg\/day|mg\/kg\/d|mg\/d|mg\/day|mg\/12 hours|mg\/12 hrs|mg\/12h))/gi,
    /(\d+\s*(?:mg|mg\/kg)\s*(?:once|twice|three times|daily|per day|every|q\.?d\.?|b\.?i\.?d\.?|t\.?i\.?d\.?))/gi,
    /(dose[:\s]+[^\.]+)/gi,
    /(dosing[:\s]+[^\.]+)/gi,
  ];
  
  const foundDosing: string[] = [];
  for (const pattern of dosingPatterns) {
    const matches = combinedText.match(pattern);
    if (matches) {
      foundDosing.push(...matches.slice(0, 3)); // Limit to 3 matches per pattern
    }
  }
  
  if (foundDosing.length > 0) {
    dosingInfo += "**Dosing Information from Study Description:**\n";
    const uniqueDosing = [...new Set(foundDosing)].slice(0, 5);
    uniqueDosing.forEach(dose => {
      dosingInfo += `- ${dose}\n`;
    });
  }
  
  return dosingInfo || "No specific dosing information found in available data.";
}

function extractDosingForSummary(study: any): string[] {
  const proto = study.protocolSection;
  const armsInterventions = proto?.armsInterventionsModule;
  const desc = proto?.descriptionModule;
  const ident = proto?.identificationModule;
  const nctId = ident?.nctId || "";
  const title = ident?.briefTitle || "";
  
  const dosingPoints: string[] = [];
  
  // Extract from interventions
  if (armsInterventions?.interventions) {
    for (const intervention of armsInterventions.interventions) {
      const name = intervention.name || "";
      if (name.toLowerCase().includes("acetylcysteine") || 
          name.toUpperCase().includes("NAC") ||
          name.toLowerCase().includes("n-acetyl")) {
        if (intervention.description) {
          // Clean up the description to extract key dosing info
          const desc = intervention.description;
          // Look for dose amounts and frequencies
          const doseMatch = desc.match(/(\d+\s*(?:mg|mg\/kg|mg\/kg\/day|mg\/kg\/d|mg\/d|mg\/day|mg\/12 hours|mg\/12 hrs|mg\/12h)[^\.]*)/i);
          if (doseMatch) {
            dosingPoints.push(`${nctId}: ${doseMatch[1].trim()}`);
          } else if (desc.length < 200) {
            // If description is short, use it directly
            dosingPoints.push(`${nctId}: ${desc}`);
          }
        }
      }
    }
  }
  
  // Extract from description text if no intervention dosing found
  if (dosingPoints.length === 0) {
    const briefSummary = desc?.briefSummary || "";
    const detailedDesc = desc?.detailedDescription || "";
    const combinedText = briefSummary + " " + detailedDesc;
    
    // Look for dosing patterns
    const dosingPatterns = [
      /(\d+\s*(?:mg|mg\/kg|mg\/kg\/day|mg\/kg\/d|mg\/d|mg\/day|mg\/12 hours|mg\/12 hrs|mg\/12h)[^\.]{0,100})/gi,
    ];
    
    for (const pattern of dosingPatterns) {
      const matches = combinedText.match(pattern);
      if (matches) {
        const uniqueDosing = [...new Set(matches)].slice(0, 2);
        uniqueDosing.forEach(dose => {
          dosingPoints.push(`${nctId}: ${dose.trim()}`);
        });
        break; // Only use first pattern that finds matches
      }
    }
  }
  
  return dosingPoints;
}

function formatRecordForModel(study: any): string {
  const proto = study.protocolSection;
  const ident = proto.identificationModule;
  const status = proto.statusModule;
  const elig = proto.eligibilityModule;
  const conds = proto.conditionsModule;
  const desc = proto.descriptionModule;
  
  const title = ident.briefTitle || "No title";
  const nctId = ident.nctId || "No NCT ID";
  const briefSummary = desc?.briefSummary || "No summary available";
  const statusText = status.overallStatus || "Unknown";
  const ageRange = `${elig?.minimumAge || "N/A"} - ${elig?.maximumAge || "N/A"}`;
  const conditions = conds?.conditions?.join(", ") || "No conditions listed";

  return [
    `**Title:** ${title}`,
    `**NCT ID:** ${nctId}`,
    `**Status:** ${statusText}`,
    `**Age Range:** ${ageRange}`,
    `**Conditions:** ${conditions}`,
    `**Brief Summary:** ${briefSummary.substring(0, 300)}${briefSummary.length > 300 ? "..." : ""}`,
    `**URL:** https://clinicaltrials.gov/study/${nctId}`,
    "---"
  ].join("\n");
}

function formatArtifactData(studies: any[]): string {
  let markdown = "# Clinical Trials Search Results\n\n";
  
  markdown += `**Total Studies Found:** ${studies.length}\n\n`;
  markdown += "---\n\n";
  
  for (let i = 0; i < studies.length; i++) {
    const study = studies[i];
    const proto = study.protocolSection;
    const ident = proto.identificationModule;
    const status = proto.statusModule;
    const elig = proto.eligibilityModule;
    const conds = proto.conditionsModule;
    const desc = proto.descriptionModule;
    const design = proto.designModule;
    const armsInterventions = proto.armsInterventionsModule;
    
    const title = ident.briefTitle || "No title";
    const nctId = ident.nctId || "No NCT ID";
    const briefSummary = desc?.briefSummary || "No summary available";
    const statusText = status.overallStatus || "Unknown";
    const ageRange = `${elig?.minimumAge || "N/A"} - ${elig?.maximumAge || "N/A"}`;
    const conditions = conds?.conditions?.join(", ") || "No conditions listed";
    
    markdown += `## ${i + 1}. ${title}\n\n`;
    markdown += `**NCT ID:** ${nctId}\n\n`;
    markdown += `**Status:** ${statusText}\n\n`;
    markdown += `**Age Range:** ${ageRange}\n\n`;
    markdown += `**Conditions:** ${conditions}\n\n`;
    
    // Brief Description
    markdown += `### Brief Description\n\n`;
    markdown += `${briefSummary}\n\n`;
    
    // Design Details
    if (design) {
      markdown += `### Design Details\n\n`;
      markdown += `- **Study Type:** ${design.studyType || "N/A"}\n`;
      if (design.phases && design.phases.length > 0) {
        markdown += `- **Phases:** ${design.phases.join(", ")}\n`;
      }
      if (design.designInfo) {
        markdown += `- **Allocation:** ${design.designInfo.allocation || "N/A"}\n`;
        markdown += `- **Intervention Model:** ${design.designInfo.interventionModel || "N/A"}\n`;
        markdown += `- **Primary Purpose:** ${design.designInfo.primaryPurpose || "N/A"}\n`;
        if (design.designInfo.maskingInfo) {
          markdown += `- **Masking:** ${design.designInfo.maskingInfo.masking || "N/A"}\n`;
        }
      }
      if (design.enrollmentInfo) {
        markdown += `- **Enrollment:** ${design.enrollmentInfo.count || "N/A"} (${design.enrollmentInfo.type || "N/A"})\n`;
      }
      markdown += "\n";
    }
    
    // Arms and Interventions
    if (armsInterventions) {
      markdown += `### Arms and Interventions\n\n`;
      
      if (armsInterventions.armGroups && armsInterventions.armGroups.length > 0) {
        markdown += `#### Arm Groups\n\n`;
        armsInterventions.armGroups.forEach((arm: any, idx: number) => {
          markdown += `${idx + 1}. **${arm.label || "Unnamed Arm"}** (${arm.type || "N/A"})\n`;
          if (arm.description) {
            markdown += `   - Description: ${arm.description}\n`;
          }
          if (arm.interventionNames && arm.interventionNames.length > 0) {
            markdown += `   - Interventions: ${arm.interventionNames.join(", ")}\n`;
          }
          markdown += "\n";
        });
      }
      
      if (armsInterventions.interventions && armsInterventions.interventions.length > 0) {
        markdown += `#### Interventions\n\n`;
        armsInterventions.interventions.forEach((intervention: any, idx: number) => {
          markdown += `${idx + 1}. **${intervention.name || "Unnamed"}** (${intervention.type || "N/A"})\n`;
          if (intervention.description) {
            markdown += `   - Description: ${intervention.description}\n`;
          }
          if (intervention.otherNames && intervention.otherNames.length > 0) {
            markdown += `   - Other Names: ${intervention.otherNames.join(", ")}\n`;
          }
          markdown += "\n";
        });
      }
    }
    
    // Dosing Information
    markdown += `### Dosing Information\n\n`;
    const dosingInfo = extractDosingInfo(study);
    markdown += `${dosingInfo}\n\n`;
    
    markdown += `**Study URL:** https://clinicaltrials.gov/study/${nctId}\n\n`;
    markdown += "---\n\n";
  }
  
  return markdown;
}

// =============================================================================
// QUERY BUILDING
// =============================================================================

// Words that are too restrictive and should be removed from other_terms
// These represent quantitative dosing information that narrows results too much
const RESTRICTIVE_WORDS = ['dosage', 'dosing', 'dose', 'doses', 'mg', 'mg/kg', 'milligram'];

function cleanOtherTerms(terms: string): string {
  // Remove quantitative dosing specifications (dose amounts, units, and related terms)
  // PRINCIPLE: Remove dose-related quantitative information while preserving descriptive study characteristics
  // This includes: dose-related words, dose units (mg, mg/kg), and numbers directly associated with doses
  // Goal: Keep descriptive terms (pediatric, adult, randomized, phase 2) while removing specific dosing info
  
  // First, remove patterns like "number + unit" or "unit + number" (e.g., "10 mg/kg", "100mg", "mg 50")
  // Handle mg/kg as a complete unit
  let cleaned = terms.replace(/\d+\s*(?:mg\/kg|mg|milligram)\b/gi, '');
  cleaned = cleaned.replace(/\b(mg\/kg|mg|milligram)\s*\d+/gi, '');
  // Remove standalone "/kg" that might remain after removing "mg/kg"
  cleaned = cleaned.replace(/\s*\/kg\b/gi, '');
  
  // Remove dose-related words with associated numbers (e.g., "dose 10", "10 doses")
  cleaned = cleaned.replace(/\d+\s*(?:dose|doses|dosage|dosing)\b/gi, '');
  cleaned = cleaned.replace(/\b(dose|doses|dosage|dosing)\s*\d+/gi, '');
  
  // Then remove standalone restrictive words
  const words = cleaned.split(/\s+/);
  const cleanedWords = words.filter(word => {
    // Skip empty strings
    if (!word) {
      return false;
    }
    // Only remove standalone numbers if they appear to be dose amounts (very large numbers > 1000)
    // This preserves legitimate numbers like "phase 2", "age 18", etc.
    if (/^\d+$/.test(word) && parseInt(word) > 1000) {
      return false;
    }
    const lowerWord = word.toLowerCase().replace(/[^a-z0-9]/g, '');
    return !RESTRICTIVE_WORDS.includes(lowerWord);
  });
  
  return cleanedWords.join(' ').trim();
}

function buildSearchQuery(
  condition: string | null,
  intervention: string | null,
  other_terms: string | null,
  max_results: number
): string {
  const params = new URLSearchParams();
  
  if (condition) {
    params.append('query.cond', condition);
  }
  if (intervention) {
    params.append('query.intr', intervention);
  }
  if (other_terms) {
    // Clean restrictive words from other_terms
    const cleanedTerms = cleanOtherTerms(other_terms);
    if (cleanedTerms.length > 0) {
      params.append('query.term', cleanedTerms);
    }
  }
  
  params.append('format', 'json');
  params.append('pageSize', max_results.toString());
  
  return params.toString();
}

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search-trials",
        description: "Search ClinicalTrials.gov for clinical trials with automatic term validation. " +
          "This tool validates search terms against ClinicalTrials.gov dictionaries and uses the most specific " +
          "search parameters (query.cond for conditions, query.intr for interventions, query.term for other terms). " +
          "\n\n" +
          "WORKFLOW:\n" +
          "1. FIRST CALL (validation): Provide condition, intervention, and/or other_terms. Set skip_validation to false or omit it. " +
          "The tool will validate each term against the appropriate dictionary. If all terms match exactly, the search runs automatically. " +
          "If some terms don't match, you'll receive suggestions for the non-matching terms.\n" +
          "2. SECOND CALL (with validated terms): After receiving suggestions, call again with skip_validation: true and the exact terms " +
          "from the suggestions. This skips validation and runs the search immediately.\n\n" +
          "PARAMETERS:\n" +
          "- condition: Disease or medical condition (e.g., 'diabetes', 'cancer'). Validated against Condition dictionary.\n" +
          "- intervention: Treatment, drug, or intervention name (e.g., 'N-acetylcysteine', 'NAC'). Validated against InterventionName dictionary.\n" +
          "- other_terms: General search terms (e.g., 'pediatric', 'adult'). Not validated, used in query.term parameter.\n" +
          "- skip_validation: Set to true when you have already validated terms and want to skip the validation step for faster execution.\n" +
          "- max_results: Maximum number of results (1-100, default: 50).\n\n" +
          "EXAMPLES:\n" +
          "First call: {\"condition\": \"diabetes\", \"intervention\": \"NAC\", \"other_terms\": \"pediatric\"}\n" +
          "Second call (after getting suggestions): {\"condition\": \"Diabetes Mellitus\", \"intervention\": \"N-Acetylcysteine\", \"other_terms\": \"pediatric\", \"skip_validation\": true}",
        inputSchema: {
          type: "object",
          properties: {
            condition: {
              type: "string",
              description: "Disease or medical condition to search for. Will be validated against ClinicalTrials.gov Condition dictionary. Examples: 'diabetes', 'cancer', 'hypertension'",
            },
            intervention: {
              type: "string",
              description: "Treatment, drug, or intervention name to search for. Will be validated against ClinicalTrials.gov InterventionName dictionary. Examples: 'N-acetylcysteine', 'NAC', 'aspirin'",
            },
            other_terms: {
              type: "string",
              description: "General search terms that don't fit into condition or intervention categories. Not validated. " +
                "PRINCIPLE: Use descriptive terms that characterize the study population, design, or context. " +
                "AVOID quantitative dosing information (dose amounts, units, and related terms) as these narrow results too much. " +
                "Terms that will be automatically removed: 'dosage', 'dosing', 'dose', 'doses', 'mg', 'mg/kg', 'milligram', " +
                "and any numbers associated with dose specifications (e.g., '10 mg/kg' becomes empty, '100mg' becomes empty). " +
                "GOOD examples: 'pediatric', 'adult', 'randomized', 'phase 2', 'double-blind', 'multicenter'. " +
                "AVOID examples: 'pediatric dosage', '10 mg/kg', 'dosing information', '100mg daily'.",
            },
            skip_validation: {
              type: "boolean",
              description: "Set to true to skip validation and run search immediately with provided terms. Use this when you have already validated terms from a previous call. Default: false",
            },
            max_results: {
              type: "number",
              description: "Maximum number of results to return (1-100, default: 50)",
              minimum: 1,
              maximum: 100,
            },
          },
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
    if (name === "search-trials") {
      const searchParams = SearchTrialsArgumentsSchema.parse(args);
      const { condition, intervention, other_terms, skip_validation, max_results } = searchParams;
      
      console.error(`[${SERVICE_NAME}] Search params:`, JSON.stringify(searchParams));
      console.error(`[${SERVICE_NAME}] Skip validation:`, skip_validation);

      // If skip_validation is true, go straight to search
      if (skip_validation) {
        console.error(`[${SERVICE_NAME}] Skipping validation, proceeding directly to search`);
        const queryString = buildSearchQuery(condition || null, intervention || null, other_terms || null, max_results);
        console.error(`[${SERVICE_NAME}] Query string:`, queryString);
        
        const searchData = await makeAPIRequest(queryString);
        
        if (!searchData) {
          return {
            content: [
              {
                type: "text",
                text: "Failed to retrieve search results from ClinicalTrials.gov API",
              },
            ],
          };
        }

        const studies = searchData.studies || [];
        
        if (studies.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No clinical trials found for the provided search terms.`,
              },
            ],
          };
        }

        const cleanedOtherTerms = other_terms ? cleanOtherTerms(other_terms) : null;
        return formatSearchResults(studies, condition || null, intervention || null, cleanedOtherTerms, other_terms || null, max_results);
      }

      // Validation workflow
      const validationResults: {
        condition?: { exactMatch: boolean, suggestions: string[], matchedTerm: string | null, originalTerm: string },
        intervention?: { exactMatch: boolean, suggestions: string[], matchedTerm: string | null, originalTerm: string },
      } = {};

      // Validate condition if provided
      if (condition) {
        console.error(`[${SERVICE_NAME}] Validating condition: "${condition}"`);
        const result = await validateTerm(condition, "Condition");
        validationResults.condition = {
          ...result,
          originalTerm: condition,
        };
        console.error(`[${SERVICE_NAME}] Condition validation: exactMatch=${result.exactMatch}, suggestions=${result.suggestions.length}`);
      }

      // Validate intervention if provided
      if (intervention) {
        console.error(`[${SERVICE_NAME}] Validating intervention: "${intervention}"`);
        const result = await validateTerm(intervention, "InterventionName");
        validationResults.intervention = {
          ...result,
          originalTerm: intervention,
        };
        console.error(`[${SERVICE_NAME}] Intervention validation: exactMatch=${result.exactMatch}, suggestions=${result.suggestions.length}`);
      }

      // Check if all provided terms have exact matches
      const conditionMatches = !condition || validationResults.condition?.exactMatch;
      const interventionMatches = !intervention || validationResults.intervention?.exactMatch;
      const allMatch = conditionMatches && interventionMatches;

      if (allMatch) {
        // All terms match exactly, proceed to search
        console.error(`[${SERVICE_NAME}] All terms matched exactly, proceeding to search`);
        const validatedCondition = validationResults.condition?.matchedTerm || condition || null;
        const validatedIntervention = validationResults.intervention?.matchedTerm || intervention || null;
        
        const queryString = buildSearchQuery(validatedCondition, validatedIntervention, other_terms || null, max_results);
        console.error(`[${SERVICE_NAME}] Query string:`, queryString);
        
        const searchData = await makeAPIRequest(queryString);
        
        if (!searchData) {
          return {
            content: [
              {
                type: "text",
                text: "Failed to retrieve search results from ClinicalTrials.gov API",
              },
            ],
          };
        }

        const studies = searchData.studies || [];
        
        if (studies.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No clinical trials found for the validated search terms.`,
              },
            ],
          };
        }

        const cleanedOtherTerms = other_terms ? cleanOtherTerms(other_terms) : null;
        return formatSearchResults(studies, validatedCondition, validatedIntervention, cleanedOtherTerms, other_terms || null, max_results);
      }

      // Some terms don't match, return validation results with suggestions
      return formatValidationResponse(validationResults, other_terms);
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

function formatValidationResponse(
  validationResults: {
    condition?: { exactMatch: boolean, suggestions: string[], matchedTerm: string | null, originalTerm: string },
    intervention?: { exactMatch: boolean, suggestions: string[], matchedTerm: string | null, originalTerm: string },
  },
  other_terms: string | undefined
): any {
  let responseText = "# Term Validation Results\n\n";
  responseText += "Some search terms did not have exact matches in the ClinicalTrials.gov dictionaries. ";
  responseText += "Please review the suggestions below and call the tool again with `skip_validation: true` and the selected terms.\n\n";

  // Condition validation results
  if (validationResults.condition) {
    responseText += "## Condition/Disease\n\n";
    if (validationResults.condition.exactMatch) {
      responseText += `✓ **Exact match found!** Will use: "${validationResults.condition.matchedTerm}"\n\n`;
    } else {
      responseText += `✗ **No exact match found** for: "${validationResults.condition.originalTerm}"\n\n`;
      if (validationResults.condition.suggestions.length > 0) {
        responseText += "**Suggestions:**\n";
        validationResults.condition.suggestions.forEach(suggestion => {
          responseText += `- ${suggestion}\n`;
        });
        responseText += "\n";
      } else {
        responseText += "No suggestions available. The term may not be in the dictionary.\n\n";
      }
    }
  }

  // Intervention validation results
  if (validationResults.intervention) {
    responseText += "## Intervention/Treatment\n\n";
    if (validationResults.intervention.exactMatch) {
      responseText += `✓ **Exact match found!** Will use: "${validationResults.intervention.matchedTerm}"\n\n`;
    } else {
      responseText += `✗ **No exact match found** for: "${validationResults.intervention.originalTerm}"\n\n`;
      if (validationResults.intervention.suggestions.length > 0) {
        responseText += "**Suggestions:**\n";
        validationResults.intervention.suggestions.forEach(suggestion => {
          responseText += `- ${suggestion}\n`;
        });
        responseText += "\n";
      } else {
        responseText += "No suggestions available. The term may not be in the dictionary.\n\n";
      }
    }
  }

  // Other terms info
  if (other_terms) {
    responseText += "## Other Terms\n\n";
    responseText += `✓ Will use as-is: "${other_terms}" (not validated)\n\n`;
  }

  responseText += "---\n\n";
  responseText += "**Next Steps:**\n";
  responseText += "1. Review the suggestions above\n";
  responseText += "2. Select the appropriate terms from the suggestions (or use the original terms if no suggestions match)\n";
  responseText += "3. Call the tool again with `skip_validation: true` and the selected terms\n\n";
  responseText += "**Example:**\n";
  responseText += "```json\n";
  responseText += "{\n";
  if (validationResults.condition) {
    const conditionToUse = validationResults.condition.matchedTerm || validationResults.condition.suggestions[0] || validationResults.condition.originalTerm;
    responseText += `  "condition": "${conditionToUse}",\n`;
  }
  if (validationResults.intervention) {
    const interventionToUse = validationResults.intervention.matchedTerm || validationResults.intervention.suggestions[0] || validationResults.intervention.originalTerm;
    responseText += `  "intervention": "${interventionToUse}",\n`;
  }
  if (other_terms) {
    responseText += `  "other_terms": "${other_terms}",\n`;
  }
  responseText += `  "skip_validation": true\n`;
  responseText += "}\n";
  responseText += "```\n";

  return {
    content: [
      {
        type: "text",
        text: responseText,
        forModel: true,
      },
    ],
  };
}

function formatSearchResults(
  studies: any[],
  condition: string | null,
  intervention: string | null,
  other_terms: string | null,
  original_other_terms: string | null,
  max_results: number
): any {
  console.log(`[DEBUG] Found ${studies.length} studies`);
  
  // Format records for text response
  const formattedRecords = studies.map(formatRecordForModel);
  
  // Create markdown artifact
  const artifactMarkdown = formatArtifactData(studies);

  // Extract dosing information for summary
  const allDosingPoints: string[] = [];
  studies.forEach((study: any) => {
    const dosingPoints = extractDosingForSummary(study);
    allDosingPoints.push(...dosingPoints);
  });

  // Build search terms summary
  const searchTerms: string[] = [];
  if (condition) searchTerms.push(`Condition: ${condition}`);
  if (intervention) searchTerms.push(`Intervention: ${intervention}`);
  if (other_terms) searchTerms.push(`Other terms: ${other_terms}`);

  // Check if other_terms were cleaned
  const termsWereCleaned = original_other_terms && original_other_terms !== other_terms;
  const cleanedWords: string[] = [];
  if (termsWereCleaned && original_other_terms) {
    const originalWords = original_other_terms.split(/\s+/);
    const cleanedWordsList = (other_terms || '').split(/\s+/);
    originalWords.forEach(word => {
      const lowerWord = word.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (RESTRICTIVE_WORDS.includes(lowerWord) && !cleanedWordsList.includes(word)) {
        cleanedWords.push(word);
      }
    });
  }

  // Create summary with instructions
  let summary = `# Clinical Trials Search Results

**Total Studies Found:** ${studies.length}

## Search Terms Used

${condition ? `- **Condition/Disease:** ${condition}` : ''}
${intervention ? `- **Intervention/Treatment:** ${intervention}` : ''}
${other_terms ? `- **Other Terms:** ${other_terms}` : ''}
${termsWereCleaned ? `- **Note:** The search term "${original_other_terms}" was cleaned to "${other_terms}" by removing restrictive words (${cleanedWords.join(', ')}). This ensures broader search results while still finding relevant trials.` : ''}

## Instructions for Summary

Please provide a concise summary of the clinical trials found. **IMPORTANT: Include the "Search Terms Used" section above in your summary** so the user knows exactly what search parameters were used. For each trial, include:
1. The condition or indication being studied
2. The NCT ID in parentheses
3. A brief description of the study's purpose or key findings

Format each trial as a separate paragraph or bullet point. 

**CRITICAL: Dosing Information Summary**
Since the user is interested in dosing information, you MUST include a comprehensive "Dosing Information Summary" section that:
1. **Summarizes dosing patterns** across all trials (e.g., "Dosing ranged from 10 mg/kg/day to 2400 mg/day")
2. **Groups by route of administration** (oral vs. intravenous)
3. **Highlights age-specific dosing** when available
4. **Notes dosing variations** by condition or study phase
5. **Includes specific examples** from the trials with NCT IDs
6. **Mentions any notable dosing schedules** (e.g., titration protocols, weight-based dosing)

After the trial summaries, include this "Dosing Information Summary" section with detailed analysis of the dosing data extracted from the trials below.

## Summary

Found ${studies.length} clinical trial(s) matching your search criteria. Each study includes:
- NCT ID and title
- Study status and enrollment information
- Age range and conditions
- Brief description
- Design details (study type, phases, allocation, masking)
- Arms and interventions
- Dosing information (when available)

## Studies

${formattedRecords.join("\n\n")}

${allDosingPoints.length > 0 ? `## Dosing Information (Raw Data)

The following dosing information was extracted from the clinical trials. **Use this data to create a comprehensive dosing summary** in your response:

${allDosingPoints.map(point => `- ${point}`).join("\n")}

**Instructions for Dosing Summary:**
Analyze the dosing data above and create a structured summary that:
- Groups dosing by route (oral, IV, etc.)
- Identifies dosing ranges and patterns
- Notes age-specific considerations
- Highlights any unique dosing protocols
- Provides specific examples with NCT IDs

` : `## Dosing Information

**Note:** Limited dosing information was found in the available trial data. Review the individual trial details in the markdown artifact for complete dosing information.

`}---

**Note:** Complete detailed information including full design details, arms/interventions, and dosing information is available in the markdown artifact.`;

  return {
    content: [
      {
        type: "text",
        text: summary,
        forModel: true
      }
    ],
    artifacts: [
      {
        type: "text/markdown",
        title: `Clinical Trials Search Results: ${searchTerms.join(" | ")}`,
        name: `clinical_trials_${Date.now()}.md`,
        content: artifactMarkdown
      }
    ]
  };
}

// =============================================================================
// SERVER STARTUP
// =============================================================================

async function main() {
  console.log(`[${SERVICE_NAME}] ClinicalTrials.gov MCP Server`);
  console.log(`[${SERVICE_NAME}] API Base URL: ${API_BASE_URL}`);
  console.log(`[${SERVICE_NAME}] No authentication required (public API)`);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log(`[${SERVICE_NAME}] MCP Server running on stdio`);
}

main().catch((error) => {
  console.error(`[${SERVICE_NAME}] Fatal error in main():`, error);
  process.exit(1);
}); 
