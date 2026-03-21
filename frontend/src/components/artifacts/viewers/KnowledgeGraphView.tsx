import { useMemo } from 'react';
import type { ViewerProps } from '../registry';

interface GraphNode {
  id: string;
  name?: string;
  label?: string;
  category?: string;
  type?: string;
}

interface GraphEdge {
  source: string;
  target: string;
  label?: string;
  predicate?: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges?: GraphEdge[];
  links?: GraphEdge[];
}

const CATEGORY_COLORS: Record<string, string> = {
  'Gene': '#1f77b4',
  'Protein': '#1f77b4',
  'biolink:Gene': '#1f77b4',
  'biolink:Protein': '#1f77b4',
  'Drug': '#e74c3c',
  'SmallMolecule': '#e74c3c',
  'biolink:Drug': '#e74c3c',
  'biolink:SmallMolecule': '#e74c3c',
  'Disease': '#1e8449',
  'biolink:Disease': '#1e8449',
  'PhenotypicFeature': '#58d68d',
  'biolink:PhenotypicFeature': '#58d68d',
  'Pathway': '#9b59b6',
  'biolink:Pathway': '#9b59b6',
  'ChemicalEntity': '#ff69b4',
  'biolink:ChemicalEntity': '#ff69b4',
  'AnatomicalEntity': '#8b4513',
  'biolink:AnatomicalEntity': '#8b4513',
  'BiologicalProcess': '#87ceeb',
  'biolink:BiologicalProcess': '#87ceeb',
  'Cell': '#d2b48c',
  'biolink:Cell': '#d2b48c',
};

function getColor(node: GraphNode): string {
  const cat = node.category || node.type || '';
  return CATEGORY_COLORS[cat] || '#999';
}

export default function KnowledgeGraphView({ content }: ViewerProps) {
  const data = useMemo<GraphData | null>(() => {
    try {
      const parsed = JSON.parse(content);
      if (parsed && parsed.nodes) return parsed;
      return null;
    } catch {
      return null;
    }
  }, [content]);

  if (!data) {
    return (
      <pre className="text-sm bg-zinc-50 dark:bg-zinc-900 rounded-xl p-4 overflow-auto whitespace-pre-wrap font-mono">
        {content}
      </pre>
    );
  }

  const edges = data.edges || data.links || [];

  // Get unique categories for legend
  const categories = [...new Set(data.nodes.map(n => n.category || n.type || 'Unknown'))];

  return (
    <div className="space-y-3">
      {/* Stats */}
      <div className="flex items-center gap-4 text-xs text-zinc-500">
        <span>{data.nodes.length} nodes</span>
        <span>{edges.length} edges</span>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2">
        {categories.map(cat => (
          <div key={cat} className="flex items-center gap-1.5 text-xs">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: CATEGORY_COLORS[cat] || '#999' }}
            />
            <span className="text-zinc-600 dark:text-zinc-400">
              {cat.replace('biolink:', '')}
            </span>
          </div>
        ))}
      </div>

      {/* Node list */}
      <div className="space-y-1 max-h-[300px] overflow-y-auto">
        {data.nodes.map(node => (
          <div
            key={node.id}
            className="flex items-center gap-2 px-2 py-1 rounded text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: getColor(node) }}
            />
            <span className="font-medium">{node.name || node.label || node.id}</span>
            <span className="text-xs text-zinc-400 font-mono">{node.id}</span>
          </div>
        ))}
      </div>

      {/* Edge list */}
      {edges.length > 0 && (
        <div className="space-y-1 max-h-[200px] overflow-y-auto border-t border-zinc-200 dark:border-zinc-700 pt-3">
          <div className="text-xs font-medium text-zinc-500 uppercase mb-1">Relationships</div>
          {edges.map((edge, i) => {
            const srcNode = data.nodes.find(n => n.id === edge.source);
            const tgtNode = data.nodes.find(n => n.id === edge.target);
            return (
              <div key={i} className="text-xs text-zinc-600 dark:text-zinc-400 px-2 py-0.5">
                <span className="font-medium">{srcNode?.name || edge.source}</span>
                {' '}
                <span className="text-accent-500">{edge.label || edge.predicate || '---'}</span>
                {' '}
                <span className="font-medium">{tgtNode?.name || edge.target}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
