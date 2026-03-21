#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  TextContent,
} from '@modelcontextprotocol/sdk/types.js';

// Types
interface EntityInfo {
  type: string;
  group: number;
}

interface GraphNode {
  id: string;
  name: string;
  entityType: string;
  group: number;
  isStartingNode: boolean;
  val: number;
  connections: number;
}

interface GraphLink {
  source: string;
  target: string;
  label: string;
  value: number;
  evidence: string[];
}

interface KnowledgeGraph {
  nodes: GraphNode[];
  links: GraphLink[];
  filteredCount: number;
  filteredNodeCount: number;
}

// API response tuple: [sourceId, sourceName, predicate, targetId, targetName, ???, evidence[]]
type MediKanrenTuple = [string, string, string, string, string, string, string[]];

function log(message: string, data?: any): void {
  console.error(`[medik-mcp] ${message}`, data ? JSON.stringify(data) : '');
}

// Entity type classification based on CURIE prefix
function getEntityType(curie: string): EntityInfo {
  const prefix = curie.split(':')[0];
  switch (prefix) {
    case 'DRUGBANK': return { type: 'Drug', group: 1 };
    case 'NCBIGene':
    case 'HGNC': return { type: 'Gene', group: 2 };
    case 'MONDO':
    case 'HP':
    case 'DOID': return { type: 'Disease', group: 3 };
    case 'UMLS': return { type: 'UMLS Concept', group: 4 };
    case 'REACT': return { type: 'Reaction', group: 5 };
    case 'NCIT': return { type: 'Cancer Concept', group: 6 };
    default: return { type: 'Other', group: 7 };
  }
}

// Make API request to MediKanren
async function makeMediKanrenRequest(subject: string, predicate: string, object: string): Promise<MediKanrenTuple[] | null> {
  const url = `https://medikanren.metareflective.systems/query0?subject=${encodeURIComponent(subject)}&predicate=${encodeURIComponent(predicate)}&object=${encodeURIComponent(object)}`;
  log(`API request`, { url });

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json', 'User-Agent': 'MediK-MCP/2.0.0' }
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      log(`API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      log(`Non-JSON response: ${contentType}`);
      return null;
    }

    const data = await response.json() as MediKanrenTuple[];
    log(`Received ${data.length} relationships`);
    return data;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      log(`Request timed out after 30s`);
    } else {
      log(`Request error: ${error}`);
    }
    return null;
  }
}

// Run bidirectional query (X->Known and Known->X)
async function runBidirectionalQuery(targetEntity: string, predicate: string = "biolink:affects"): Promise<MediKanrenTuple[]> {
  log(`Bidirectional query: ${targetEntity} with predicate ${predicate}`);

  const [query1Results, query2Results] = await Promise.all([
    makeMediKanrenRequest(targetEntity, predicate, ""),
    makeMediKanrenRequest("", predicate, targetEntity),
  ]);

  const allResults: MediKanrenTuple[] = [];
  if (query1Results) allResults.push(...query1Results);
  if (query2Results) allResults.push(...query2Results);

  // Deduplicate
  const seen = new Set<string>();
  const deduplicated = allResults.filter((tuple) => {
    const key = `${tuple[0]}-${tuple[2]}-${tuple[3]}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  log(`Deduplicated: ${allResults.length} -> ${deduplicated.length}`);
  return deduplicated;
}

// Create knowledge graph from raw API data
function createKnowledgeGraph(rawData: MediKanrenTuple[], queryEntity: string): KnowledgeGraph {
  const nodes = new Map<string, GraphNode>();
  const links: GraphLink[] = [];
  let filteredCount = 0;
  let filteredNodeCount = 0;

  for (const tuple of rawData) {
    const [sourceId, sourceName, predicate, targetId, targetName, , evidence] = tuple;

    // Filter CAID nodes (unreliable variant data)
    if (sourceId.startsWith('CAID:') || targetId.startsWith('CAID:')) {
      filteredNodeCount++;
      continue;
    }

    // Filter basic transcription relationships
    if (predicate === 'biolink:transcribed_from') {
      filteredCount++;
      continue;
    }

    // Normalize UniProtKB versioned IDs
    const normSrc = sourceId.replace(/^(UniProtKB:[^-]+)-\d+$/, '$1');
    const normTgt = targetId.replace(/^(UniProtKB:[^-]+)-\d+$/, '$1');

    if (!nodes.has(normSrc)) {
      const info = getEntityType(normSrc);
      nodes.set(normSrc, {
        id: normSrc, name: sourceName || normSrc, entityType: info.type,
        group: info.group, isStartingNode: normSrc === queryEntity, val: 10, connections: 0
      });
    }

    if (!nodes.has(normTgt)) {
      const info = getEntityType(normTgt);
      nodes.set(normTgt, {
        id: normTgt, name: targetName || normTgt, entityType: info.type,
        group: info.group, isStartingNode: normTgt === queryEntity, val: 10, connections: 0
      });
    }

    nodes.get(normSrc)!.connections++;
    nodes.get(normTgt)!.connections++;

    links.push({
      source: normSrc,
      target: normTgt,
      label: predicate.replace('biolink:', '').replace(/_/g, ' '),
      value: 1,
      evidence: evidence || []
    });
  }

  const nodeArray = Array.from(nodes.values());
  nodeArray.forEach(n => { n.val = Math.min(20, Math.max(5, 5 + n.connections)); });

  return { nodes: nodeArray, links, filteredCount, filteredNodeCount };
}

// Find connecting paths between multiple entities via 2-hop BFS
async function findConnectingPaths(entities: string[]): Promise<{
  nodes: GraphNode[]; links: GraphLink[];
  prunedNodes: number; prunedLinks: number;
}> {
  const neighborCache = new Map<string, string[]>();

  async function getNeighbors(nodeId: string): Promise<string[]> {
    if (nodeId.startsWith('CAID:')) return [];
    if (neighborCache.has(nodeId)) return neighborCache.get(nodeId)!;

    const neighbors: string[] = [];
    const [r1, r2] = await Promise.all([
      makeMediKanrenRequest(nodeId, "biolink:affects", ""),
      makeMediKanrenRequest("", "biolink:affects", nodeId),
    ]);

    if (r1) for (const t of r1) if (t[3] && t[3] !== nodeId && !t[3].startsWith('CAID:')) neighbors.push(t[3]);
    if (r2) for (const t of r2) if (t[0] && t[0] !== nodeId && !t[0].startsWith('CAID:') && !neighbors.includes(t[0])) neighbors.push(t[0]);

    neighborCache.set(nodeId, neighbors);
    return neighbors;
  }

  // Multi-source BFS, 2 hops
  const allNodes = new Set<string>();
  const adjacencyList = new Map<string, Set<string>>();
  const visited = new Set<string>();
  const queue: Array<{ nodeId: string; depth: number }> = [];

  for (const e of entities) {
    queue.push({ nodeId: e, depth: 0 });
    visited.add(e);
    allNodes.add(e);
    adjacencyList.set(e, new Set());
  }

  while (queue.length > 0) {
    const { nodeId, depth } = queue.shift()!;
    if (depth >= 2) continue;

    const neighbors = await getNeighbors(nodeId);
    for (const nid of neighbors) {
      if (nid.startsWith('CAID:')) continue;
      allNodes.add(nid);
      if (!adjacencyList.has(nodeId)) adjacencyList.set(nodeId, new Set());
      if (!adjacencyList.has(nid)) adjacencyList.set(nid, new Set());
      adjacencyList.get(nodeId)!.add(nid);
      adjacencyList.get(nid)!.add(nodeId);
      if (!visited.has(nid)) {
        visited.add(nid);
        queue.push({ nodeId: nid, depth: depth + 1 });
      }
    }

    // Be courteous to the server
    if (queue.length > 0) await new Promise(r => setTimeout(r, 500));
  }

  // Prune leaf nodes that aren't start nodes
  const startSet = new Set(entities);
  const origNodeCount = adjacencyList.size;
  const origLinkCount = Array.from(adjacencyList.values()).reduce((s, set) => s + set.size, 0) / 2;

  let removed = true;
  while (removed) {
    removed = false;
    const toRemove: string[] = [];
    adjacencyList.forEach((neighbors, node) => {
      if (!startSet.has(node) && neighbors.size <= 1) toRemove.push(node);
    });
    if (toRemove.length > 0) {
      removed = true;
      for (const node of toRemove) {
        const neighbors = adjacencyList.get(node) || new Set();
        neighbors.forEach(n => adjacencyList.get(n)?.delete(node));
        adjacencyList.delete(node);
      }
    }
  }

  // Build graph
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const processedEdges = new Set<string>();

  for (const nodeId of adjacencyList.keys()) {
    const info = getEntityType(nodeId);
    const conns = adjacencyList.get(nodeId)?.size || 0;
    nodes.push({
      id: nodeId, name: nodeId, entityType: info.type, group: info.group,
      isStartingNode: startSet.has(nodeId), val: Math.min(20, Math.max(5, 5 + conns)), connections: conns
    });
  }

  adjacencyList.forEach((neighbors, src) => {
    neighbors.forEach(tgt => {
      const key = [src, tgt].sort().join('->');
      if (!processedEdges.has(key)) {
        processedEdges.add(key);
        links.push({ source: src, target: tgt, label: 'affects', value: 1, evidence: [] });
      }
    });
  });

  const finalNodeCount = adjacencyList.size;
  const finalLinkCount = Array.from(adjacencyList.values()).reduce((s, set) => s + set.size, 0) / 2;

  return {
    nodes, links,
    prunedNodes: origNodeCount - finalNodeCount,
    prunedLinks: origLinkCount - finalLinkCount,
  };
}

// Create the MCP server
const server = new Server({
  name: 'medik-mcp',
  version: '2.0.0',
}, {
  capabilities: { tools: {} },
});

// List tools
server.setRequestHandler(ListToolsRequestSchema, async (): Promise<{ tools: Tool[] }> => {
  return {
    tools: [
      {
        name: 'get-everything',
        description: 'Get all biomedical relationships for a given entity using biolink:affects predicate (bidirectional query)',
        inputSchema: {
          type: 'object',
          properties: {
            entity: {
              type: 'string',
              description: 'The entity to query (CURIE format, e.g., "HGNC:8651", "NCBIGene:4893", "DRUGBANK:DB12411")',
            },
          },
          required: ['entity'],
        },
      },
      {
        name: 'query-with-predicate',
        description: 'Query biomedical relationships with a specific predicate (bidirectional)',
        inputSchema: {
          type: 'object',
          properties: {
            entity: {
              type: 'string',
              description: 'The entity to query (CURIE format)',
            },
            predicate: {
              type: 'string',
              description: 'The biolink predicate (e.g., "biolink:treats", "biolink:affects", "biolink:related_to")',
            },
          },
          required: ['entity', 'predicate'],
        },
      },
      {
        name: 'get-connecting-paths',
        description: 'Find connecting paths between multiple biomedical entities within 2-hop neighborhoods',
        inputSchema: {
          type: 'object',
          properties: {
            entities: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of entities in CURIE format (e.g., ["HGNC:8651", "DRUGBANK:DB12411"])',
              minItems: 2,
            },
          },
          required: ['entities'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  log(`Tool call: ${name}`, args);

  try {
    if (name === 'get-everything') {
      const entity = args?.entity as string;
      if (!entity) throw new Error('Entity parameter is required');

      const rawData = await runBidirectionalQuery(entity);

      if (rawData.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `No relationships found for entity: ${entity}. Verify the CURIE format (e.g., "HGNC:8651").`
          } as TextContent]
        };
      }

      const graph = createKnowledgeGraph(rawData, entity);
      const entityTypes = Array.from(new Set(graph.nodes.map(n => n.entityType)));

      return {
        content: [{
          type: 'text',
          text: `# Knowledge Graph: ${entity}\n\nFound ${graph.links.length} relationships connecting ${graph.nodes.length} entities.\n\n## Statistics\n- **Nodes**: ${graph.nodes.length}\n- **Relationships**: ${graph.links.length}\n- **Filtered out**: ${graph.filteredCount} basic relationships, ${graph.filteredNodeCount} unreliable nodes\n\n## Entity Types\n${entityTypes.map(t => `- ${t}`).join('\n')}\n\n## Graph Data\n\`\`\`json\n${JSON.stringify(graph, null, 2)}\n\`\`\``
        } as TextContent],
        artifacts: [{
          type: 'application/vnd.knowledge-graph',
          title: `Knowledge Graph: ${entity}`,
          content: graph,
        }],
      } as any;

    } else if (name === 'query-with-predicate') {
      const entity = args?.entity as string;
      const predicate = args?.predicate as string;
      if (!entity || !predicate) throw new Error('Both entity and predicate parameters are required');

      const rawData = await runBidirectionalQuery(entity, predicate);

      if (rawData.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `No relationships found for entity: ${entity} with predicate: ${predicate}.`
          } as TextContent]
        };
      }

      const graph = createKnowledgeGraph(rawData, entity);
      const entityTypes = Array.from(new Set(graph.nodes.map(n => n.entityType)));

      return {
        content: [{
          type: 'text',
          text: `# Knowledge Graph: ${entity} (${predicate})\n\nFound ${graph.links.length} relationships connecting ${graph.nodes.length} entities.\n\n## Statistics\n- **Nodes**: ${graph.nodes.length}\n- **Relationships**: ${graph.links.length}\n- **Filtered out**: ${graph.filteredCount} basic relationships, ${graph.filteredNodeCount} unreliable nodes\n\n## Entity Types\n${entityTypes.map(t => `- ${t}`).join('\n')}\n\n## Graph Data\n\`\`\`json\n${JSON.stringify(graph, null, 2)}\n\`\`\``
        } as TextContent],
        artifacts: [{
          type: 'application/vnd.knowledge-graph',
          title: `Knowledge Graph: ${entity} (${predicate})`,
          content: graph,
        }],
      } as any;

    } else if (name === 'get-connecting-paths') {
      const entities = args?.entities as string[];
      if (!entities || entities.length < 2) throw new Error('At least two entities are required');

      const result = await findConnectingPaths(entities);

      if (result.nodes.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `No connecting paths found between: ${entities.join(', ')}`
          } as TextContent]
        };
      }

      const entityTypes = Array.from(new Set(result.nodes.map(n => n.entityType)));

      return {
        content: [{
          type: 'text',
          text: `# Connecting Paths\n\nFound paths connecting ${result.nodes.length} entities via ${result.links.length} relationships.\n\n## Statistics\n- **Nodes**: ${result.nodes.length}\n- **Relationships**: ${result.links.length}\n- **Pruned**: ${result.prunedNodes} leaf nodes, ${result.prunedLinks} isolated edges\n\n## Entity Types\n${entityTypes.map(t => `- ${t}`).join('\n')}\n\n## Graph Data\n\`\`\`json\n${JSON.stringify({ nodes: result.nodes, links: result.links }, null, 2)}\n\`\`\``
        } as TextContent],
        artifacts: [{
          type: 'application/vnd.knowledge-graph',
          title: `Connecting Paths: ${entities.join(' ↔ ')}`,
          content: { nodes: result.nodes, links: result.links },
        }],
      } as any;

    } else {
      throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    log(`Error in ${name}: ${error}`);
    return {
      content: [{ type: 'text', text: `Error: ${error.message || error}` } as TextContent],
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
