import { v4 as uuidv4 } from 'uuid';

// Define types for the knowledge graph data structure
interface KnowledgeGraphNode {
  id: string;
  name: string;
  group: number;
  val?: number;
  color?: string;
  entityType?: string;
}

interface KnowledgeGraphLink {
  source: string;
  target: string;
  value?: number;
  label: string;
  color?: string;
  evidence?: string[];
}

interface KnowledgeGraph {
  nodes: KnowledgeGraphNode[];
  links: KnowledgeGraphLink[];
}

interface KnowledgeGraphArtifact {
  type: string;
  title: string;
  content: string; // JSON stringified graph data
}

interface FormattedResult {
  content: {
    type: string;
    text: string;
  }[];
  artifacts?: KnowledgeGraphArtifact[];
}

// Interface for STRING-DB interaction data
interface InteractionResponseWithEvidence {
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
  detailedEvidence?: {
    text_mining?: {
      publications?: string[];
    };
  } | null;
}

// Helper function to determine evidence strength
function getEvidenceStrength(score: number): { strength: string; color: string } {
  if (score >= 900) {
    return { strength: 'Very High', color: '#1a9850' }; // Dark green
  } else if (score >= 700) {
    return { strength: 'High', color: '#66bd63' }; // Green
  } else if (score >= 500) {
    return { strength: 'Medium', color: '#fee08b' }; // Yellow
  } else if (score >= 300) {
    return { strength: 'Low', color: '#fdae61' }; // Orange
  } else {
    return { strength: 'Very Low', color: '#d73027' }; // Red
  }
}

// Helper function to format evidence scores
export function formatEvidenceScores(interaction: InteractionResponseWithEvidence): string {
  const scores = [
    `Total combined score: ${interaction.score}`,
    `- Neighborhood score: ${interaction.nscore}`,
    `- Gene Fusion score: ${interaction.fscore}`,
    `- Co-occurrence score: ${interaction.pscore}`,
    `- Co-expression score: ${interaction.ascore}`,
    `- Experimental score: ${interaction.escore}`,
    `- Database score: ${interaction.dscore}`,
    `- Text-mining score: ${interaction.tscore}`
  ];
  
  const publications = interaction.detailedEvidence?.text_mining?.publications;
  if (publications && publications.length > 0) {
    scores.push(
      `\nSupporting Publications (PubMed IDs):`,
      publications.map(pubmed => `  - PMID: ${pubmed}`).join('\n')
    );
  }
  
  return scores.join('\n');
}

/**
 * Formats STRING-DB protein interactions into human-readable text and a knowledge graph artifact
 * 
 * @param interactionData - The protein interaction data from STRING-DB
 * @param queryProtein - The protein that was queried
 * @returns An object with content (text) and artifacts (knowledge graph)
 */
export function formatProteinInteractionsGraph(
  interactionData: InteractionResponseWithEvidence[],
  queryProtein: string
): FormattedResult {
  // Initialize the knowledge graph structure
  const graph: KnowledgeGraph = {
    nodes: [],
    links: []
  };
  
  // Track unique nodes to avoid duplicates
  const nodeMap = new Map<string, KnowledgeGraphNode>();
  
  // Track node connections for sizing
  const connectionCounts = new Map<string, number>();
  
  // Process each interaction
  interactionData.forEach(interaction => {
    const sourceId = interaction.stringId_A;
    const targetId = interaction.stringId_B;
    const sourceName = interaction.preferredName_A;
    const targetName = interaction.preferredName_B;
    
    // Process source node
    if (!nodeMap.has(sourceId)) {
      nodeMap.set(sourceId, {
        id: sourceId,
        name: sourceName,
        group: 1, // Query protein and its direct interactions
        entityType: 'Protein'
      });
    }
    
    // Process target node
    if (!nodeMap.has(targetId)) {
      nodeMap.set(targetId, {
        id: targetId,
        name: targetName,
        group: 1, // Query protein and its direct interactions
        entityType: 'Protein'
      });
    }
    
    // Update connection counts
    connectionCounts.set(sourceId, (connectionCounts.get(sourceId) || 0) + 1);
    connectionCounts.set(targetId, (connectionCounts.get(targetId) || 0) + 1);
    
    // Get evidence strength and color
    const { strength, color } = getEvidenceStrength(interaction.score);
    
    // Get supporting publications as evidence
    const publications = interaction.detailedEvidence?.text_mining?.publications || [];
    
    // Add link
    graph.links.push({
      source: sourceId,
      target: targetId,
      label: `Interaction (${strength})`,
      value: interaction.score / 200, // Scale for visualization
      color: color,
      evidence: publications
    });
  });
  
  // Update node sizes based on connection counts
  nodeMap.forEach((node, id) => {
    const connections = connectionCounts.get(id) || 1;
    node.val = Math.max(5, Math.min(20, connections * 3)); // Scale node size between 5 and 20
    
    // Highlight the query protein
    if (node.name.toLowerCase() === queryProtein.toLowerCase()) {
      node.color = '#ff5500'; // Highlight color
      node.group = 0; // Special group for the query protein
    }
  });
  
  // Convert node map to array
  graph.nodes = Array.from(nodeMap.values());
  
  // Create human-readable text
  const interactionSummaries = interactionData.map(interaction => {
    const { strength } = getEvidenceStrength(interaction.score);
    return `- ${interaction.preferredName_A} interacts with ${interaction.preferredName_B} (Confidence: ${strength}, Score: ${interaction.score})`;
  });
  
  const humanReadableText = `
# Protein Interaction Network for ${queryProtein}

The graph shows protein-protein interactions for ${queryProtein} from the STRING database.

## Summary of Interactions
${interactionSummaries.join('\n')}

## Interaction Details
${interactionData.map(interaction => {
  return [
    `\n### ${interaction.preferredName_A} <-> ${interaction.preferredName_B}`,
    formatEvidenceScores(interaction)
  ].join('\n');
}).join('\n\n')}

Examine the network to identify key interaction partners, potential functional clusters, and the strength of evidence supporting each interaction.
`;

  // Create the knowledge graph artifact
  const artifact: KnowledgeGraphArtifact = {
    type: 'application/vnd.knowledge-graph',
    title: `Protein Interaction Network: ${queryProtein}`,
    content: JSON.stringify(graph)
  };
  
  return {
    content: [
      {
        type: 'text',
        text: humanReadableText
      }
    ],
    artifacts: [artifact]
  };
}

/**
 * Formats STRING-DB pathway enrichment data into human-readable text and a knowledge graph artifact
 * 
 * @param enrichmentData - The pathway enrichment data from STRING-DB
 * @param proteins - The proteins that were queried
 * @returns An object with content (text) and artifacts (knowledge graph)
 */
export function formatPathwayEnrichmentGraph(
  enrichmentData: Array<{
    pathway: string;
    description: string;
    p_value: number;
    genes: string[];
  }>,
  proteins: string[]
): FormattedResult {
  // Initialize the knowledge graph structure
  const graph: KnowledgeGraph = {
    nodes: [],
    links: []
  };
  
  // Track unique nodes to avoid duplicates
  const nodeMap = new Map<string, KnowledgeGraphNode>();
  
  // Add all query proteins as nodes
  proteins.forEach(protein => {
    const proteinId = `protein_${protein}`;
    nodeMap.set(proteinId, {
      id: proteinId,
      name: protein,
      group: 1, // Protein group
      entityType: 'Protein',
      val: 10 // Standard size for proteins
    });
  });
  
  // Process each pathway
  enrichmentData.forEach(pathway => {
    const pathwayId = `pathway_${pathway.pathway}`;
    
    // Add pathway node
    nodeMap.set(pathwayId, {
      id: pathwayId,
      name: pathway.description,
      group: 2, // Pathway group
      entityType: 'Pathway',
      val: Math.max(10, Math.min(25, 15 - Math.log10(pathway.p_value) * 2)) // Size based on significance
    });
    
    // Add links from genes to pathway
    pathway.genes.forEach(gene => {
      const geneId = `protein_${gene}`;
      
      // Add gene node if it doesn't exist
      if (!nodeMap.has(geneId)) {
        nodeMap.set(geneId, {
          id: geneId,
          name: gene,
          group: 1, // Protein group
          entityType: 'Protein',
          val: 8 // Slightly smaller than query proteins
        });
      }
      
      // Add link
      graph.links.push({
        source: geneId,
        target: pathwayId,
        label: 'part_of',
        value: 1,
        color: '#2171b5' // Blue for pathway membership
      });
    });
  });
  
  // Convert node map to array
  graph.nodes = Array.from(nodeMap.values());
  
  // Create human-readable text
  const pathwaySummaries = enrichmentData.map(pathway => {
    return `- ${pathway.description} (p-value: ${pathway.p_value.toExponential(2)})`;
  });
  
  const humanReadableText = `
# Pathway Enrichment Analysis for ${proteins.join(', ')}

The graph shows enriched pathways for the provided proteins from the STRING database.

## Summary of Enriched Pathways
${pathwaySummaries.join('\n')}

## Detailed Pathway Information
${enrichmentData.map(pathway => {
  return [
    `\n### ${pathway.description}`,
    `P-value: ${pathway.p_value.toExponential(2)}`,
    `Genes: ${pathway.genes.join(', ')}`
  ].join('\n');
}).join('\n\n')}

Examine the network to identify which pathways are most significantly enriched and which proteins contribute to multiple pathways.
`;

  // Create the knowledge graph artifact
  const artifact: KnowledgeGraphArtifact = {
    type: 'application/vnd.knowledge-graph',
    title: `Pathway Enrichment: ${proteins.join(', ')}`,
    content: JSON.stringify(graph)
  };
  
  return {
    content: [
      {
        type: 'text',
        text: humanReadableText
      }
    ],
    artifacts: [artifact]
  };
} 