import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import fetch from "node-fetch";

// =============================================================================
// CONFIGURATION SECTION - NCBI and UniProt API Configuration
// =============================================================================

const NCBI_BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const UNIPROT_BASE_URL = "https://rest.uniprot.org/uniprotkb";
const EMAIL = "mcp-tool@example.com";
const TOOL_NAME = "variant-domain-mcp";
const SERVICE_NAME = "variant-domain-mapper";

// Rate limiting
const RATE_LIMIT_DELAY = 1000; // 1 second between NCBI requests

// =============================================================================
// SCHEMA DEFINITIONS
// =============================================================================

const MapVariantSchema = z.object({
  transcript_id: z.string().describe("RefSeq transcript ID (e.g., NM_005228.3)"),
  gene_symbol: z.string().describe("Gene symbol (e.g., EGFR)"),
  protein_change: z.string().describe("Protein change in HGVS format (e.g., p.Leu883Ser)"),
  coding_change: z.string().optional().describe("Coding change in HGVS format (e.g., c.2648T>C)"),
  output_format: z.enum(["markdown", "visualization"]).optional().default("markdown").describe("Output format: 'markdown' for text or 'visualization' for Nightingale visualization")
});

const GetProteinDomainsSchema = z.object({
  gene_symbol: z.string().describe("Gene symbol to get domain information for"),
  uniprot_id: z.string().optional().describe("UniProt ID (if known)")
});

const BatchMapVariantsSchema = z.object({
  variants: z.array(z.object({
    transcript_id: z.string(),
    gene_symbol: z.string(),
    protein_change: z.string(),
    coding_change: z.string().optional()
  })).describe("Array of variants to map")
});

// =============================================================================
// TYPES
// =============================================================================

interface VariantInfo {
  geneSymbol: string;
  proteinChange: string;
  codingChange?: string;
}

interface ParsedVariant {
  fromAA: string;
  position: number;
  toAA: string;
}

interface DomainData {
  domains: Domain[];
  features: Feature[];
  ptms: PTMData[];
  uniprotIds: string[];
  gene: {
    geneId: string;
    geneName: string;
  };
  proteinLength: number;
  domainCoverage: number; // Percentage of protein covered by domains
}

interface Domain {
  begin: number;
  end: number;
  description: string;
  evidence: string[];
  confidence?: 'high' | 'medium' | 'low';
  length?: number;
  lengthCategory?: 'small' | 'medium' | 'large';
  clinicalRelevance?: {
    isDrugTarget: boolean;
    isCancerAssociated: boolean;
    hasKnownMutations: boolean;
  };
}

interface Feature {
  type: string;
  begin: number;
  end: number;
  description: string;
  category?: 'functional_site' | 'structural_feature' | 'modification_site' | 'regulatory_element';
  importance?: 'critical' | 'important' | 'moderate';
  conservation?: 'highly_conserved' | 'moderately_conserved' | 'variable';
}

interface PTMData {
  type: string;
  position: number;
  description: string;
  category: 'phosphorylation' | 'glycosylation' | 'ubiquitination' | 'methylation' | 'acetylation' | 'lipidation' | 'other';
  clinicalRelevance?: 'drug_target' | 'disease_associated' | 'regulatory' | 'unknown';
  conservation?: 'highly_conserved' | 'moderately_conserved' | 'variable';
}

interface Alignment {
  sequence1: {
    name: string;
    sequence: string;
    length: number;
  };
  sequence2: {
    name: string;
    sequence: string;
    length: number;
  };
  identical: boolean;
  differences: any[];
  positionMapping: { [key: number]: number };
}

interface DomainImpact {
  hasImpact: boolean;
  domains: (Domain & { index: number })[];
  features: (Feature & { index: number })[];
  position: number;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseVariantPosition(proteinChange: string): ParsedVariant {
  const match = proteinChange.match(/p\.([A-Za-z]{3})(\d+)([A-Za-z]{3})/);
  if (!match) {
    throw new Error(`Invalid protein change format: ${proteinChange}`);
  }

  return {
    fromAA: match[1],
    position: parseInt(match[2]),
    toAA: match[3]
  };
}

// =============================================================================
// NCBI API FUNCTIONS
// =============================================================================

async function getProteinFromTranscript(transcriptId: string): Promise<string | null> {
  try {
    console.log(`🔍 Converting transcript ${transcriptId} to protein accession...`);
    await sleep(RATE_LIMIT_DELAY);
    
    // Search for the transcript
    const searchUrl = `${NCBI_BASE_URL}/esearch.fcgi`;
    const searchParams = new URLSearchParams({
      db: 'nuccore',
      term: transcriptId,
      retmode: 'json',
      email: EMAIL,
      tool: TOOL_NAME
    });

    const searchResponse = await fetch(`${searchUrl}?${searchParams}`);
    const searchData = await searchResponse.json() as any;
    let nucleotideId = searchData.esearchresult.idlist[0];
    
    if (!nucleotideId) {
      // Try without version number
      const baseTranscript = transcriptId.split('.')[0];
      console.log(`⚠️  Transcript ${transcriptId} not found, trying ${baseTranscript}...`);
      
      const altSearchParams = new URLSearchParams({
        db: 'nuccore',
        term: baseTranscript,
        retmode: 'json',
        email: EMAIL,
        tool: TOOL_NAME
      });

      await sleep(RATE_LIMIT_DELAY);
      const altSearchResponse = await fetch(`${searchUrl}?${altSearchParams}`);
      const altSearchData = await altSearchResponse.json() as any;
      nucleotideId = altSearchData.esearchresult.idlist[0];
      
      if (!nucleotideId) {
        throw new Error(`Transcript ${transcriptId} not found`);
      }
    }

    // Check if transcript was replaced with newer version
    await sleep(RATE_LIMIT_DELAY);
    const summaryUrl = `${NCBI_BASE_URL}/esummary.fcgi`;
    const summaryParams = new URLSearchParams({
      db: 'nuccore',
      id: nucleotideId,
      retmode: 'json',
      email: EMAIL,
      tool: TOOL_NAME
    });

    const summaryResponse = await fetch(`${summaryUrl}?${summaryParams}`);
    const summaryData = await summaryResponse.json() as any;
    const summary = summaryData.result[nucleotideId];
    
    if (summary?.replacedby) {
      console.log(`⚠️  Transcript ${transcriptId} was replaced by ${summary.replacedby}`);
      console.log(`🔄 Using current version: ${summary.replacedby}`);
      return await getProteinFromTranscript(summary.replacedby);
    }

    // Approach 1: Try elink
    let proteinAccession: string | null = null;
    try {
      await sleep(RATE_LIMIT_DELAY);
      const linkUrl = `${NCBI_BASE_URL}/elink.fcgi`;
      const linkParams = new URLSearchParams({
        dbfrom: 'nuccore',
        db: 'protein',
        id: nucleotideId,
        retmode: 'json',
        email: EMAIL,
        tool: TOOL_NAME
      });

      const linkResponse = await fetch(`${linkUrl}?${linkParams}`);
      const linkData = await linkResponse.json() as any;
      const links = linkData.linksets[0]?.linksetdbs?.find((db: any) => db.dbto === 'protein');
      
      if (links && links.links && links.links.length > 0) {
        const proteinId = links.links[0];

        await sleep(RATE_LIMIT_DELAY);
        const protSummaryParams = new URLSearchParams({
          db: 'protein',
          id: proteinId,
          retmode: 'json',
          email: EMAIL,
          tool: TOOL_NAME
        });

        const protSummaryResponse = await fetch(`${summaryUrl}?${protSummaryParams}`);
        const protSummaryData = await protSummaryResponse.json() as any;
        proteinAccession = protSummaryData.result[proteinId].caption;
        
        console.log(`✅ Found protein via elink: ${proteinAccession}`);
        return proteinAccession;
      }
    } catch (linkError) {
      console.log(`⚠️  elink approach failed: ${linkError}`);
    }

    // Approach 2: Try direct protein search (NM_ → NP_)
    try {
      const transcriptBase = transcriptId.split('.')[0].replace('NM_', 'NP_');
      console.log(`🔄 Trying direct protein search: ${transcriptBase}`);
      
      await sleep(RATE_LIMIT_DELAY);
      const protSearchParams = new URLSearchParams({
        db: 'protein',
        term: transcriptBase,
        retmode: 'json',
        email: EMAIL,
        tool: TOOL_NAME
      });

      const protSearchResponse = await fetch(`${searchUrl}?${protSearchParams}`);
      const protSearchData = await protSearchResponse.json() as any;
      
      if (protSearchData.esearchresult.idlist.length > 0) {
        const proteinId = protSearchData.esearchresult.idlist[0];
        
        await sleep(RATE_LIMIT_DELAY);
        const protSummaryParams = new URLSearchParams({
          db: 'protein',
          id: proteinId,
          retmode: 'json',
          email: EMAIL,
          tool: TOOL_NAME
        });

        const protSummaryResponse = await fetch(`${summaryUrl}?${protSummaryParams}`);
        const protSummaryData = await protSummaryResponse.json() as any;
        proteinAccession = protSummaryData.result[proteinId].caption;
        
        console.log(`✅ Found protein via direct search: ${proteinAccession}`);
        return proteinAccession;
      }
    } catch (directError) {
      console.log(`⚠️  Direct search approach failed: ${directError}`);
    }

    throw new Error(`No protein found for transcript ${transcriptId} using any method`);
  } catch (error) {
    console.error(`Error converting transcript to protein:`, error);
    return null;
  }
}

async function getProteinSequence(proteinAccession: string): Promise<string> {
  await sleep(RATE_LIMIT_DELAY);
  
  const fetchUrl = `${NCBI_BASE_URL}/efetch.fcgi`;
  const fetchParams = new URLSearchParams({
    db: 'protein',
    id: proteinAccession,
    rettype: 'fasta',
    retmode: 'text',
    email: EMAIL,
    tool: TOOL_NAME
  });

  const response = await fetch(`${fetchUrl}?${fetchParams}`);
  const fastaText = await response.text();
  
  // Extract sequence from FASTA
  const lines = fastaText.split('\n');
  const sequence = lines.slice(1).join('').replace(/\s/g, '');
  
  return sequence;
}

// =============================================================================
// UNIPROT API FUNCTIONS
// =============================================================================

async function getUniprotData(geneSymbol: string): Promise<DomainData | null> {
  try {
    // Search UniProt by gene name, preferring reviewed Swiss-Prot entries
    const searchUrl = `${UNIPROT_BASE_URL}/search?query=gene:${geneSymbol}+AND+organism_id:9606+AND+reviewed:true&format=json&size=1`;
    const searchResponse = await fetch(searchUrl);
    
    if (!searchResponse.ok) {
      console.error(`UniProt search failed: ${searchResponse.status} ${searchResponse.statusText}`);
      return null;
    }
    
    const searchData = await searchResponse.json() as any;
    
    if (!searchData.results || searchData.results.length === 0) {
      // Fallback to unreviewed entries if no reviewed entry found
      console.log(`No reviewed UniProt entry found for ${geneSymbol}, trying unreviewed...`);
      const fallbackUrl = `${UNIPROT_BASE_URL}/search?query=gene:${geneSymbol}+AND+organism_id:9606&format=json&size=1`;
      const fallbackResponse = await fetch(fallbackUrl);
      
      if (!fallbackResponse.ok) {
        return null;
      }
      
      const fallbackData = await fallbackResponse.json() as any;
      if (!fallbackData.results || fallbackData.results.length === 0) {
        return null;
      }
      searchData.results = fallbackData.results;
    }

    const entry = searchData.results[0];
    const uniprotId = entry.primaryAccession;

    // The search response already contains the full entry data
    const detailData = entry;

    // Extract domains, features, and PTMs with enhancements
    const domains: Domain[] = [];
    const features: Feature[] = [];
    const ptms: PTMData[] = [];
    const proteinLength = detailData.sequence?.length || 0;

    if (detailData.features) {
      detailData.features.forEach((feature: any) => {
        if (feature.type === 'Domain' || feature.type === 'Topological domain') {
          const domainLength = feature.location.end.value - feature.location.start.value + 1;
          const domain: Domain = {
            begin: feature.location.start.value,
            end: feature.location.end.value,
            description: feature.description || feature.type,
            evidence: feature.evidences?.map((e: any) => e.code) || [],
            length: domainLength,
            lengthCategory: categorizeDomainLength(domainLength),
            clinicalRelevance: analyzeClinicalRelevance(feature.description || feature.type)
          };
          domain.confidence = analyzeDomainConfidence(domain);
          domains.push(domain);
        } else if (['Repeat', 'Region', 'Motif', 'Site', 'Active site', 'Binding site'].includes(feature.type)) {
          const enhancedFeature: Feature = {
            type: feature.type,
            begin: feature.location.start.value,
            end: feature.location.end.value,
            description: feature.description || feature.type,
            category: categorizeFeature(feature.type, feature.description || feature.type),
            importance: analyzeFeatureImportance(feature.type, feature.description || feature.type)
          };
          features.push(enhancedFeature);
        } else if (['Modified residue', 'Glycosylation', 'Cross-link', 'Lipidation'].includes(feature.type)) {
          const ptm: PTMData = {
            type: feature.type,
            position: feature.location.start.value,
            description: feature.description || feature.type,
            category: categorizePTM(feature.type, feature.description || feature.type),
            clinicalRelevance: analyzePTMClinicalRelevance(feature.description || feature.type)
          };
          ptms.push(ptm);
        }
      });
    }

    const domainCoverage = calculateDomainCoverage(domains, proteinLength);

    return {
      domains,
      features,
      ptms,
      proteinLength,
      domainCoverage,
      uniprotIds: [uniprotId],
      gene: {
        geneId: entry.genes?.[0]?.geneName || geneSymbol,
        geneName: geneSymbol
      }
    };
  } catch (error) {
    console.error('Error fetching UniProt data:', error);
    return null;
  }
}

async function getUniprotSequence(uniprotId: string): Promise<string> {
  const url = `${UNIPROT_BASE_URL}/${uniprotId}?format=json`;
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch UniProt sequence: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json() as any;
  return data.sequence.value;
}

// =============================================================================
// VISUALIZATION HELPER FUNCTIONS
// =============================================================================

function getColorForDomain(index: number): string {
  const colors = [
    "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FECA57",
    "#FF9FF3", "#54A0FF", "#48DBFB", "#0ABDE3", "#00D2D3"
  ];
  return colors[index % colors.length];
}

function getColorForFeatureType(type: string): string {
  const colorMap: Record<string, string> = {
    "Active site": "#FF5252",
    "Binding site": "#536DFE",
    "Site": "#FFAB40",
    "Motif": "#7C4DFF",
    "Region": "#64FFDA",
    "Default": "#9E9E9E"
  };
  return colorMap[type] || colorMap.Default;
}

// =============================================================================
// ENHANCEMENT FUNCTIONS - Low-hanging fruit implementations
// =============================================================================

function categorizePTM(type: string, description: string): PTMData['category'] {
  const lowerType = type.toLowerCase();
  const lowerDesc = description.toLowerCase();
  
  if (lowerType.includes('phospho') || lowerDesc.includes('phospho')) return 'phosphorylation';
  if (lowerType.includes('glycosyl') || lowerDesc.includes('glycosyl') || lowerDesc.includes('n-linked') || lowerDesc.includes('o-linked')) return 'glycosylation';
  if (lowerType.includes('ubiquit') || lowerDesc.includes('ubiquit')) return 'ubiquitination';
  if (lowerType.includes('methyl') || lowerDesc.includes('methyl')) return 'methylation';
  if (lowerType.includes('acetyl') || lowerDesc.includes('acetyl')) return 'acetylation';
  if (lowerType.includes('lipid') || lowerDesc.includes('lipid') || lowerDesc.includes('myristoyl') || lowerDesc.includes('palmitoyl')) return 'lipidation';
  return 'other';
}

function analyzeDomainConfidence(domain: Domain): 'high' | 'medium' | 'low' {
  // Simple heuristic based on evidence and description quality
  if (domain.evidence.length > 0 && !domain.description.toLowerCase().includes('predicted')) return 'high';
  if (domain.description.toLowerCase().includes('predicted') || domain.description.toLowerCase().includes('probable')) return 'low';
  return 'medium';
}

function categorizeDomainLength(length: number): 'small' | 'medium' | 'large' {
  if (length < 50) return 'small';
  if (length < 200) return 'medium';
  return 'large';
}

function analyzeClinicalRelevance(description: string): Domain['clinicalRelevance'] {
  const lowerDesc = description.toLowerCase();
  
  const isDrugTarget = 
    lowerDesc.includes('kinase') || 
    lowerDesc.includes('receptor') || 
    lowerDesc.includes('enzyme') ||
    lowerDesc.includes('protease') ||
    lowerDesc.includes('transporter');
    
  const isCancerAssociated = 
    lowerDesc.includes('oncogene') || 
    lowerDesc.includes('tumor') || 
    lowerDesc.includes('cancer') ||
    lowerDesc.includes('proliferation') ||
    lowerDesc.includes('apoptosis');
    
  const hasKnownMutations = 
    lowerDesc.includes('mutation') || 
    lowerDesc.includes('variant') || 
    lowerDesc.includes('polymorphism');
  
  return {
    isDrugTarget,
    isCancerAssociated,
    hasKnownMutations
  };
}

function categorizeFeature(type: string, description: string): Feature['category'] {
  const lowerType = type.toLowerCase();
  
  if (['active site', 'binding site', 'catalytic'].some(term => lowerType.includes(term))) {
    return 'functional_site';
  }
  if (['modified residue', 'glycosylation', 'cross-link', 'lipidation'].some(term => lowerType.includes(term))) {
    return 'modification_site';
  }
  if (['region', 'domain', 'repeat'].some(term => lowerType.includes(term))) {
    return 'structural_feature';
  }
  return 'regulatory_element';
}

function analyzeFeatureImportance(type: string, description: string): Feature['importance'] {
  const lowerType = type.toLowerCase();
  const lowerDesc = description.toLowerCase();
  
  if (lowerType.includes('active site') || lowerDesc.includes('catalytic')) return 'critical';
  if (['binding site', 'regulatory', 'essential'].some(term => lowerDesc.includes(term))) return 'important';
  return 'moderate';
}

function analyzePTMClinicalRelevance(description: string): PTMData['clinicalRelevance'] {
  const lowerDesc = description.toLowerCase();
  
  if (lowerDesc.includes('drug') || lowerDesc.includes('inhibitor') || lowerDesc.includes('therapeutic')) return 'drug_target';
  if (lowerDesc.includes('disease') || lowerDesc.includes('cancer') || lowerDesc.includes('pathogenic')) return 'disease_associated';
  if (lowerDesc.includes('regulat') || lowerDesc.includes('control') || lowerDesc.includes('signal')) return 'regulatory';
  return 'unknown';
}

function calculateDomainCoverage(domains: Domain[], proteinLength: number): number {
  if (proteinLength === 0) return 0;
  
  // Create array to track covered positions
  const covered = new Array(proteinLength).fill(false);
  
  // Mark positions covered by domains
  domains.forEach(domain => {
    for (let i = domain.begin - 1; i < domain.end && i < proteinLength; i++) {
      covered[i] = true;
    }
  });
  
  // Calculate percentage
  const coveredPositions = covered.filter(pos => pos).length;
  return Math.round((coveredPositions / proteinLength) * 100);
}

// =============================================================================
// CORE MAPPING FUNCTIONS
// =============================================================================

function alignSequences(seq1: string, seq2: string, seq1Name: string, seq2Name: string): Alignment {
  const alignment: Alignment = {
    sequence1: {
      name: seq1Name,
      sequence: seq1,
      length: seq1.length
    },
    sequence2: {
      name: seq2Name,
      sequence: seq2,
      length: seq2.length
    },
    identical: seq1 === seq2,
    differences: [],
    positionMapping: {}
  };

  if (seq1 === seq2) {
    // Create 1:1 position mapping
    for (let i = 1; i <= seq1.length; i++) {
      alignment.positionMapping[i] = i;
    }
  } else {
    // Simple alignment assuming minimal gaps
    const minLength = Math.min(seq1.length, seq2.length);
    
    for (let i = 0; i < minLength; i++) {
      if (seq1[i] !== seq2[i]) {
        alignment.differences.push({
          position1: i + 1,
          position2: i + 1,
          aa1: seq1[i],
          aa2: seq2[i]
        });
      }
      alignment.positionMapping[i + 1] = i + 1;
    }
  }

  return alignment;
}

function checkDomainImpact(position: number, domainData: DomainData): DomainImpact {
  const impactedDomains: (Domain & { index: number })[] = [];
  const impactedFeatures: (Feature & { index: number })[] = [];

  // Check domains
  domainData.domains.forEach((domain, index) => {
    if (position >= domain.begin && position <= domain.end) {
      impactedDomains.push({
        ...domain,
        index: index + 1
      });
    }
  });

  // Check features
  domainData.features.forEach((feature, index) => {
    if (position >= feature.begin && position <= feature.end) {
      impactedFeatures.push({
        ...feature,
        index: index + 1
      });
    }
  });

  return {
    hasImpact: impactedDomains.length > 0 || impactedFeatures.length > 0,
    domains: impactedDomains,
    features: impactedFeatures,
    position
  };
}

// =============================================================================
// FORMATTING FUNCTIONS
// =============================================================================

function formatVariantMappingAsMarkdown(result: any): string {
  let markdown = `# Variant-to-Domain Mapping Results\n\n`;
  
  // Input Summary
  markdown += `## Input Information\n\n`;
  markdown += `- **Transcript ID**: ${result.input.transcriptId}\n`;
  markdown += `- **Protein Accession**: ${result.input.proteinAccession}\n`;
  markdown += `- **Gene Symbol**: ${result.input.variant.geneSymbol}\n`;
  markdown += `- **Protein Change**: ${result.input.variant.proteinChange}\n`;
  if (result.input.variant.codingChange) {
    markdown += `- **Coding Change**: ${result.input.variant.codingChange}\n`;
  }
  markdown += `\n`;

  // Sequence Information
  markdown += `## Sequence Information\n\n`;
  markdown += `- **Transcript Protein**: ${result.alignment.sequence1.length} amino acids\n`;
  markdown += `- **UniProt Reference**: ${result.alignment.sequence2.length} amino acids\n`;
  markdown += `- **Sequences Identical**: ${result.alignment.identical ? '✅ Yes' : '❌ No'}\n`;
  
  if (!result.alignment.identical && result.alignment.differences.length > 0) {
    markdown += `- **Differences Found**: ${result.alignment.differences.length}\n\n`;
    if (result.alignment.differences.length <= 5) {
      markdown += `### Sequence Differences\n\n`;
      markdown += `| Position | RefSeq | UniProt |\n`;
      markdown += `|----------|--------|----------|\n`;
      result.alignment.differences.forEach((diff: any) => {
        markdown += `| ${diff.position1} | ${diff.aa1} | ${diff.aa2} |\n`;
      });
      markdown += `\n`;
    }
  }

  // Position Mapping
  markdown += `## Variant Position Mapping\n\n`;
  markdown += `- **Original Position**: ${result.mapping.transcriptPosition} (${result.input.proteinAccession})\n`;
  markdown += `- **UniProt Position**: ${result.mapping.uniprotPosition} (${result.uniprotData.uniprotIds[0]})\n`;
  markdown += `- **Amino Acid Change**: ${result.mapping.aminoAcidChange.original} → ${result.mapping.aminoAcidChange.mutated}\n\n`;

  // Domain Impact
  markdown += `## Domain Impact Analysis\n\n`;
  if (result.domainImpact.hasImpact) {
    markdown += `### ✅ VARIANT IMPACTS FUNCTIONAL REGIONS\n\n`;
    
    if (result.domainImpact.domains.length > 0) {
      markdown += `#### Impacted Protein Domains (${result.domainImpact.domains.length})\n\n`;
      result.domainImpact.domains.forEach((domain: any) => {
        markdown += `**${domain.index}. ${domain.description}**\n`;
        markdown += `- Domain Range: ${domain.begin} - ${domain.end}\n`;
        markdown += `- Variant Position: ${result.mapping.uniprotPosition}\n`;
        markdown += `- Evidence: ${domain.evidence.join(', ') || 'N/A'}\n\n`;
      });
    }

    if (result.domainImpact.features.length > 0) {
      markdown += `#### Impacted Structural Features (${result.domainImpact.features.length})\n\n`;
      result.domainImpact.features.forEach((feature: any) => {
        markdown += `**${feature.index}. ${feature.type}: ${feature.description}**\n`;
        markdown += `- Feature Range: ${feature.begin} - ${feature.end}\n`;
        markdown += `- Variant Position: ${result.mapping.uniprotPosition}\n\n`;
      });
    }
  } else {
    markdown += `### ❌ No Domain Impact Detected\n\n`;
    markdown += `Position ${result.mapping.uniprotPosition} is outside all annotated domains and features.\n\n`;
  }

  // Domain Map
  markdown += `## Domain Map Visualization\n\n`;
  markdown += formatDomainMap(result);

  // External Resources
  markdown += `## External Resources\n\n`;
  markdown += `- [NCBI Protein](https://www.ncbi.nlm.nih.gov/protein/${result.input.proteinAccession})\n`;
  markdown += `- [UniProt](https://www.uniprot.org/uniprot/${result.uniprotData.uniprotIds[0]})\n`;
  if (result.uniprotData.gene.geneId) {
    markdown += `- [NCBI Gene](https://www.ncbi.nlm.nih.gov/gene/${result.uniprotData.gene.geneId})\n`;
  }

  return markdown;
}

function formatDomainMap(result: any): string {
  const proteinLength = result.alignment.sequence2.length;
  const variantPos = result.mapping.uniprotPosition;
  const domains = result.uniprotData.domains || [];

  let markdown = "```\n";
  markdown += `Protein: 1 ${'─'.repeat(60)} ${proteinLength}\n\n`;
  
  domains.forEach((domain: any, index: number) => {
    const scale = proteinLength / 60;
    const startPos = Math.round(domain.begin / scale);
    const endPos = Math.round(domain.end / scale);
    
    let map = ' '.repeat(70);
    let mapArray = map.split('');
    
    // Mark domain
    for (let i = startPos; i <= endPos && i < 60; i++) {
      mapArray[i] = '█';
    }
    
    // Mark variant position if in this domain
    const variantMapPos = Math.round(variantPos / scale);
    if (variantPos >= domain.begin && variantPos <= domain.end) {
      if (variantMapPos < 60) {
        mapArray[variantMapPos] = '↑';
      }
    }
    
    markdown += `Domain ${index + 1}: ${mapArray.join('')}\n`;
    markdown += `${domain.description} (${domain.begin}-${domain.end})\n`;
    
    if (variantPos >= domain.begin && variantPos <= domain.end) {
      markdown += `*** VARIANT IMPACT: Position ${variantPos} ***\n`;
    }
    markdown += '\n';
  });
  
  markdown += "```\n";
  return markdown;
}

function formatDomainsAsMarkdown(domainData: DomainData, geneSymbol: string): string {
  let markdown = `# 🧬 Enhanced Protein Domain Analysis for ${geneSymbol}\n\n`;
  
  // Protein Overview with enhancements
  markdown += `## 📊 Protein Overview\n\n`;
  markdown += `- **UniProt ID**: ${domainData.uniprotIds[0]}\n`;
  markdown += `- **Gene Name**: ${domainData.gene.geneName}\n`;
  markdown += `- **Protein Length**: ${domainData.proteinLength} amino acids\n`;
  markdown += `- **Domain Coverage**: ${domainData.domainCoverage}% of protein sequence\n`;
  markdown += `- **Total Domains**: ${domainData.domains.length}\n`;
  markdown += `- **Functional Sites**: ${domainData.features.length}\n`;
  markdown += `- **PTM Sites**: ${domainData.ptms.length}\n\n`;

  // Enhanced Domains Section
  if (domainData.domains.length > 0) {
    markdown += `## 🎯 Protein Domains (${domainData.domains.length})\n\n`;
    
    // Summary by confidence
    const highConf = domainData.domains.filter(d => d.confidence === 'high').length;
    const medConf = domainData.domains.filter(d => d.confidence === 'medium').length;
    const lowConf = domainData.domains.filter(d => d.confidence === 'low').length;
    
    markdown += `**Confidence Summary**: 🟢 High: ${highConf} | 🟡 Medium: ${medConf} | 🔴 Low: ${lowConf}\n\n`;
    
    domainData.domains.forEach((domain, index) => {
      const confIcon = domain.confidence === 'high' ? '🟢' : domain.confidence === 'medium' ? '🟡' : '🔴';
      const sizeIcon = domain.lengthCategory === 'large' ? '📏' : domain.lengthCategory === 'medium' ? '📐' : '📌';
      
      markdown += `### ${index + 1}. ${confIcon} ${domain.description}\n`;
      markdown += `- **Position**: ${domain.begin} - ${domain.end}\n`;
      markdown += `- **Length**: ${domain.length} AA (${domain.lengthCategory} ${sizeIcon})\n`;
      markdown += `- **Confidence**: ${domain.confidence}\n`;
      markdown += `- **Evidence**: ${domain.evidence.join(', ') || 'Not specified'}\n`;
      
      // Clinical relevance
      if (domain.clinicalRelevance) {
        const clinical = [];
        if (domain.clinicalRelevance.isDrugTarget) clinical.push('🎯 Drug Target');
        if (domain.clinicalRelevance.isCancerAssociated) clinical.push('🔬 Cancer Associated');
        if (domain.clinicalRelevance.hasKnownMutations) clinical.push('🧬 Known Mutations');
        if (clinical.length > 0) {
          markdown += `- **Clinical Relevance**: ${clinical.join(', ')}\n`;
        }
      }
      markdown += `\n`;
    });
  } else {
    markdown += `## No Protein Domains Found\n\n`;
  }

  // Enhanced Features Section
  if (domainData.features.length > 0) {
    markdown += `## ⚙️ Functional Sites & Features (${domainData.features.length})\n\n`;
    
    const featuresByCategory = {
      'functional_site': domainData.features.filter(f => f.category === 'functional_site'),
      'modification_site': domainData.features.filter(f => f.category === 'modification_site'),
      'structural_feature': domainData.features.filter(f => f.category === 'structural_feature'),
      'regulatory_element': domainData.features.filter(f => f.category === 'regulatory_element')
    };
    
    Object.entries(featuresByCategory).forEach(([category, features]) => {
      if (features.length > 0) {
        const categoryIcon = {
          'functional_site': '🎯',
          'modification_site': '🔄',
          'structural_feature': '🏗️',
          'regulatory_element': '⚡'
        }[category] || '📍';
        
        markdown += `### ${categoryIcon} ${category.replace('_', ' ').toUpperCase()} (${features.length})\n\n`;
        
        features.forEach(feature => {
          const impIcon = feature.importance === 'critical' ? '🔴' : feature.importance === 'important' ? '🟡' : '🟢';
          markdown += `- ${impIcon} **${feature.description}** (${feature.type}): ${feature.begin}`;
          if (feature.end !== feature.begin) markdown += `-${feature.end}`;
          if (feature.importance) markdown += ` | ${feature.importance}`;
          markdown += `\n`;
        });
        markdown += `\n`;
      }
    });
  }

     // Enhanced PTM Section
   if (domainData.ptms.length > 0) {
     markdown += `## 🔄 Post-Translational Modifications (${domainData.ptms.length})\n\n`;
     
     const ptmsByCategory: Record<string, PTMData[]> = {};
     domainData.ptms.forEach(ptm => {
       if (!ptmsByCategory[ptm.category]) ptmsByCategory[ptm.category] = [];
       ptmsByCategory[ptm.category].push(ptm);
     });
     
     Object.entries(ptmsByCategory).forEach(([category, ptms]) => {
      const categoryIcon = {
        'phosphorylation': '⚡',
        'glycosylation': '🍯',
        'ubiquitination': '🏷️',
        'methylation': '🎨',
        'acetylation': '✏️',
        'lipidation': '🧈',
        'other': '🔄'
      }[category] || '🔄';
      
      markdown += `### ${categoryIcon} ${category.toUpperCase()} (${ptms.length})\n\n`;
      
      ptms.forEach(ptm => {
        const clinIcon = ptm.clinicalRelevance === 'drug_target' ? '🎯' : 
                        ptm.clinicalRelevance === 'disease_associated' ? '🔬' :
                        ptm.clinicalRelevance === 'regulatory' ? '⚡' : '📍';
        
        markdown += `- ${clinIcon} **Position ${ptm.position}**: ${ptm.description}`;
        if (ptm.clinicalRelevance && ptm.clinicalRelevance !== 'unknown') {
          markdown += ` (${ptm.clinicalRelevance.replace('_', ' ')})`;
        }
        markdown += `\n`;
      });
      markdown += `\n`;
    });
  }

  // External Links
  markdown += `## 🔗 External Resources\n\n`;
  markdown += `- [UniProt Entry](https://www.uniprot.org/uniprot/${domainData.uniprotIds[0]})\n`;
  markdown += `- [InterPro Analysis](https://www.ebi.ac.uk/interpro/search/text/${geneSymbol})\n`;
  markdown += `- [Pfam Domains](https://www.ebi.ac.uk/interpro/search/text/${geneSymbol}/?filter=pfam)\n`;
  markdown += `- [AlphaFold Structure](https://alphafold.ebi.ac.uk/search/text/${geneSymbol})\n`;
  markdown += `- [PDB Structures](https://www.rcsb.org/search?request={"query":{"type":"group","logical_operator":"and","nodes":[{"type":"terminal","service":"text","parameters":{"attribute":"entity.rcsb_entity_source_organism.taxonomy_lineage.name","operator":"exact_match","value":"${geneSymbol}"}}]},"return_type":"entry","request_options":{"pager":{"start":0,"rows":25}},"request_info":{"src":"ui","query_id":""}}\n`;

  return markdown;
}

// =============================================================================
// MAIN MAPPING FUNCTION
// =============================================================================

async function mapVariantToDomains(
  transcriptId: string,
  variantInfo: VariantInfo
): Promise<any> {
  // Step 1: Convert transcript to protein accession
  let proteinAccession: string | null = null;
  let transcriptSequence: string | null = null;
  let useUniprotFallback = false;
  
  try {
    proteinAccession = await getProteinFromTranscript(transcriptId);
    if (proteinAccession) {
      // Step 2: Get transcript-specific protein sequence
      transcriptSequence = await getProteinSequence(proteinAccession);
    }
  } catch (error) {
    console.warn(`NCBI lookup failed for transcript ${transcriptId}, using UniProt fallback`);
    useUniprotFallback = true;
  }
  
  // Step 3: Get UniProt data
  const uniprotData = await getUniprotData(variantInfo.geneSymbol);
  if (!uniprotData || !uniprotData.domains) {
    throw new Error(`Could not retrieve UniProt domain data for: ${variantInfo.geneSymbol}`);
  }

  // Step 4: Get UniProt sequence
  const uniprotSequence = await getUniprotSequence(uniprotData.uniprotIds[0]);
  
  // Use UniProt sequence if NCBI failed
  if (useUniprotFallback || !transcriptSequence) {
    transcriptSequence = uniprotSequence;
    console.log(`Using UniProt sequence as fallback for ${variantInfo.geneSymbol}`);
  }

  // Ensure we have a valid sequence
  if (!transcriptSequence) {
    throw new Error(`Could not retrieve protein sequence for ${variantInfo.geneSymbol}`);
  }

  // Step 5: Parse variant position
  const variantPosition = parseVariantPosition(variantInfo.proteinChange);

  // Step 6: Perform sequence alignment
  const refName = proteinAccession || transcriptId;
  const alignment = alignSequences(transcriptSequence, uniprotSequence, refName, uniprotData.uniprotIds[0]);

  // Step 7: Map variant position
  const mappedPosition = alignment.positionMapping[variantPosition.position];
  if (!mappedPosition) {
    throw new Error(`Could not map position ${variantPosition.position}`);
  }

  // Step 8: Check domain impact
  const domainImpact = checkDomainImpact(mappedPosition, uniprotData);

  // Step 9: Create result
  return {
    input: {
      transcriptId,
      proteinAccession,
      variant: variantInfo
    },
    alignment,
    mapping: {
      transcriptPosition: variantPosition.position,
      uniprotPosition: mappedPosition,
      aminoAcidChange: {
        original: variantPosition.fromAA,
        mutated: variantPosition.toAA
      }
    },
    domainImpact,
    uniprotData
  };
}

// =============================================================================
// SERVER IMPLEMENTATION
// =============================================================================

const server = new Server(
  {
    name: SERVICE_NAME,
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "map-variant-to-domains",
        description: "Map a genetic variant to protein domains using transcript ID and protein change notation",
        inputSchema: {
          type: "object",
          properties: {
            transcript_id: { type: "string", description: "RefSeq transcript ID (e.g., NM_005228.3)" },
            gene_symbol: { type: "string", description: "Gene symbol (e.g., EGFR)" },
            protein_change: { type: "string", description: "Protein change in HGVS format (e.g., p.Leu858Arg)" },
            coding_change: { type: "string", description: "Coding change in HGVS format (optional, e.g., c.2573T>G)" },
            output_format: { 
              type: "string", 
              enum: ["markdown", "visualization"],
              description: "Output format: 'markdown' for text or 'visualization' for Nightingale visualization (default: markdown)" 
            },
          },
          required: ["transcript_id", "gene_symbol", "protein_change"],
        },
      },
      {
        name: "get-protein-domains",
        description: "Get all protein domains for a gene symbol",
        inputSchema: {
          type: "object",
          properties: {
            gene_symbol: { type: "string", description: "Gene symbol (e.g., EGFR)" },
          },
          required: ["gene_symbol"],
        },
      },
      {
        name: "batch-map-variants",
        description: "Map multiple variants to protein domains in batch",
        inputSchema: {
          type: "object",
          properties: {
            variants: {
              type: "array",
              description: "Array of variants to map",
              items: {
                type: "object",
                properties: {
                  transcript_id: { type: "string", description: "RefSeq transcript ID" },
                  gene_symbol: { type: "string", description: "Gene symbol" },
                  protein_change: { type: "string", description: "Protein change in HGVS format" },
                  coding_change: { type: "string", description: "Coding change in HGVS format (optional)" },
                },
                required: ["transcript_id", "gene_symbol", "protein_change"],
              },
            },
          },
          required: ["variants"],
        },
      }
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "map-variant-to-domains") {
      const params = MapVariantSchema.parse(args);
      
      const variantInfo: VariantInfo = {
        geneSymbol: params.gene_symbol,
        proteinChange: params.protein_change,
        codingChange: params.coding_change
      };

      const result = await mapVariantToDomains(params.transcript_id, variantInfo);
      
      // Check output format
      if (params.output_format === "visualization") {
        // Get UniProt sequence for visualization
        const uniprotSequence = await getUniprotSequence(result.uniprotData.uniprotIds[0]);
        
        // Create enhanced visualization data
        const visualizationData = {
          proteinId: result.uniprotData.uniprotIds[0],
          sequence: uniprotSequence,
          length: uniprotSequence.length,
          proteinOverview: {
            domainCoverage: result.uniprotData.domainCoverage,
            totalDomains: result.uniprotData.domains.length,
            totalFeatures: result.uniprotData.features.length,
            totalPTMs: result.uniprotData.ptms.length
          },
          tracks: [
            {
              type: "domain",
              label: "Protein Domains",
              expandable: true,
              features: result.uniprotData.domains.map((domain: any, idx: number) => {
                const confidenceColor = domain.confidence === 'high' ? '#4CAF50' : 
                                       domain.confidence === 'medium' ? '#FF9800' : '#F44336';
                const strokeWidth = domain.clinicalRelevance?.isDrugTarget ? 3 : 1;
                return {
                  accession: `domain_${idx}`,
                  start: domain.begin,
                  end: domain.end,
                  color: getColorForDomain(idx),
                  borderColor: confidenceColor,
                  strokeWidth: strokeWidth,
                  description: domain.description,
                  evidence: domain.evidence,
                  metadata: {
                    confidence: domain.confidence,
                    length: domain.length,
                    lengthCategory: domain.lengthCategory,
                    clinicalRelevance: domain.clinicalRelevance
                  },
                  contributors: [
                    { database: "UniProt", accession: "Domain", name: domain.description },
                    { database: "InterPro", accession: "IPR000000", name: "Predicted from sequence" }
                  ]
                };
              })
            },
            {
              type: "variant",
              label: "Variant Position",
              features: [{
                accession: "variant",
                start: result.mapping.uniprotPosition,
                end: result.mapping.uniprotPosition,
                color: "#FF0000",
                description: `${params.protein_change} (${params.coding_change || 'N/A'})`,
                shape: "circle",
                size: 8
              }]
            },
            {
              type: "functional_sites",
              label: "Functional Sites",
              features: result.uniprotData.features
                .filter((f: any) => f.category === 'functional_site')
                .map((feature: any, idx: number) => ({
                  accession: `functional_${idx}`,
                  start: feature.begin,
                  end: feature.end,
                  color: feature.importance === 'critical' ? '#D32F2F' : 
                         feature.importance === 'important' ? '#F57C00' : '#388E3C',
                  description: `${feature.type}: ${feature.description}`,
                  shape: feature.begin === feature.end ? "circle" : "rounded-rectangle",
                  metadata: {
                    category: feature.category,
                    importance: feature.importance
                  }
                }))
            },
            {
              type: "ptm_sites",
              label: "PTM Sites",
              features: result.uniprotData.ptms.map((ptm: any, idx: number) => {
                const categoryColors = {
                  'phosphorylation': '#9C27B0',
                  'glycosylation': '#FF9800',
                  'ubiquitination': '#795548',
                  'methylation': '#3F51B5',
                  'acetylation': '#009688',
                  'lipidation': '#FFC107',
                  'other': '#607D8B'
                };
                return {
                  accession: `ptm_${idx}`,
                  start: ptm.position,
                  end: ptm.position,
                  color: categoryColors[ptm.category as keyof typeof categoryColors] || categoryColors.other,
                  description: `${ptm.type}: ${ptm.description}`,
                  shape: "circle",
                  size: ptm.clinicalRelevance === 'drug_target' ? 6 : 4,
                  metadata: {
                    category: ptm.category,
                    clinicalRelevance: ptm.clinicalRelevance
                  }
                };
              })
            },
            {
              type: "other_features",
              label: "Structural Features",
              features: result.uniprotData.features
                .filter((f: any) => f.category !== 'functional_site')
                .map((feature: any, idx: number) => ({
                  accession: `struct_${idx}`,
                  start: feature.begin,
                  end: feature.end,
                  color: getColorForFeatureType(feature.type),
                  description: `${feature.type}: ${feature.description}`,
                  shape: feature.begin === feature.end ? "circle" : "rounded-rectangle",
                  metadata: {
                    category: feature.category,
                    importance: feature.importance
                  }
                }))
            }
          ]
        };
        
        const summaryInstructions = `Visualizing variant ${params.protein_change} on ${params.gene_symbol} protein. The visualization shows:
1. Protein domains in different colors
2. Variant position marked with a red diamond
3. Functional features like active sites and binding sites
Please describe what the visualization reveals about the variant's location relative to functional regions.`;

        return {
          content: [
            {
              type: "text",
              text: `${summaryInstructions}\n\nThe interactive protein visualization is shown in the artifact below.`,
            }
          ],
          artifacts: [
            {
              type: "application/vnd.protein-visualization",
              title: `${params.gene_symbol} Domain Visualization`,
              content: JSON.stringify(visualizationData)
            }
          ],
        };
      } else {
        // Default markdown output
        const markdownContent = formatVariantMappingAsMarkdown(result);

        // Create summarization instructions
        const summaryInstructions = `Based on the conversation context, summarize the variant mapping results focusing on:
1. Whether the variant ${params.protein_change} impacts any functional protein domains
2. The specific domains or features affected (if any)
3. The clinical or functional significance of the affected regions
4. The position mapping between transcript and UniProt coordinates`;

        return {
          content: [
            {
              type: "text",
              text: `${summaryInstructions}\n\nThe full variant mapping analysis is available in the artifact below.`,
            }
          ],
          artifacts: [
            {
              type: "text/markdown",
              title: `Variant Domain Mapping: ${params.gene_symbol} ${params.protein_change}`,
              content: markdownContent
            }
          ],
        };
      }
    }

    if (name === "get-protein-domains") {
      const params = GetProteinDomainsSchema.parse(args);
      
      const domainData = await getUniprotData(params.gene_symbol);
      if (!domainData) {
        throw new Error(`No domain data found for gene: ${params.gene_symbol}`);
      }

      const markdownContent = formatDomainsAsMarkdown(domainData, params.gene_symbol);

      const summaryInstructions = `Based on the conversation context, summarize the protein domain information for ${params.gene_symbol}, highlighting:
1. The key functional domains present in the protein
2. Important structural features (active sites, binding sites, etc.)
3. The relevance of these domains to the protein's function`;

      return {
        content: [
          {
            type: "text",
            text: `${summaryInstructions}\n\nThe complete domain information is available in the artifact below.`,
          }
        ],
        artifacts: [
          {
            type: "text/markdown",
            title: `Protein Domains: ${params.gene_symbol}`,
            content: markdownContent
          }
        ],
      };
    }

    if (name === "batch-map-variants") {
      const params = BatchMapVariantsSchema.parse(args);
      
      let batchMarkdown = `# Batch Variant-to-Domain Mapping Results\n\n`;
      batchMarkdown += `Processing ${params.variants.length} variants...\n\n`;

      const results = [];
      
      for (const variant of params.variants) {
        try {
          const variantInfo: VariantInfo = {
            geneSymbol: variant.gene_symbol,
            proteinChange: variant.protein_change,
            codingChange: variant.coding_change
          };

          const result = await mapVariantToDomains(variant.transcript_id, variantInfo);
          results.push({
            success: true,
            variant,
            domainImpact: result.domainImpact.hasImpact,
            impactedDomains: result.domainImpact.domains.length,
            impactedFeatures: result.domainImpact.features.length
          });

          batchMarkdown += `---\n\n`;
          batchMarkdown += `## ${variant.gene_symbol} ${variant.protein_change}\n\n`;
          batchMarkdown += `- **Status**: ✅ Success\n`;
          batchMarkdown += `- **Domain Impact**: ${result.domainImpact.hasImpact ? 'Yes' : 'No'}\n`;
          if (result.domainImpact.hasImpact) {
            batchMarkdown += `- **Impacted Domains**: ${result.domainImpact.domains.length}\n`;
            batchMarkdown += `- **Impacted Features**: ${result.domainImpact.features.length}\n`;
          }
          batchMarkdown += `\n`;

        } catch (error) {
          results.push({
            success: false,
            variant,
            error: error instanceof Error ? error.message : 'Unknown error'
          });

          batchMarkdown += `---\n\n`;
          batchMarkdown += `## ${variant.gene_symbol} ${variant.protein_change}\n\n`;
          batchMarkdown += `- **Status**: ❌ Failed\n`;
          batchMarkdown += `- **Error**: ${error instanceof Error ? error.message : 'Unknown error'}\n\n`;
        }
      }

      // Summary
      const successful = results.filter(r => r.success).length;
      const withImpact = results.filter(r => r.success && r.domainImpact).length;
      
      batchMarkdown = `# Batch Variant-to-Domain Mapping Results\n\n` +
        `## Summary\n\n` +
        `- **Total Variants**: ${params.variants.length}\n` +
        `- **Successfully Mapped**: ${successful}\n` +
        `- **With Domain Impact**: ${withImpact}\n` +
        `- **Failed**: ${params.variants.length - successful}\n\n` +
        batchMarkdown;

      const summaryInstructions = `Summarize the batch variant mapping results:
1. How many variants were successfully mapped
2. How many variants impact functional domains
3. Any patterns in domain impacts across variants
4. Any failures and their reasons`;

      return {
        content: [
          {
            type: "text",
            text: `${summaryInstructions}\n\nDetailed results for all ${params.variants.length} variants are in the artifact below.`,
          }
        ],
        artifacts: [
          {
            type: "text/markdown",
            title: `Batch Variant Mapping Results (${params.variants.length} variants)`,
            content: batchMarkdown
          }
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Invalid arguments: ${error.errors.map(e => `${e.path}: ${e.message}`).join(", ")}`);
    }
    throw error;
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
}); 