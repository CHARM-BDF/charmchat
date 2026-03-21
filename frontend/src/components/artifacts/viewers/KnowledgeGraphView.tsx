import { useMemo, useState } from 'react';
import { GraphCanvas } from 'reagraph';
import type { GraphNode as ReagraphNode, GraphEdge as ReagraphEdge } from 'reagraph';
import type { ViewerProps } from '../registry';

interface InputNode {
  id: string;
  name?: string;
  label?: string;
  category?: string;
  type?: string;
  entityType?: string;
}

interface InputEdge {
  source: string;
  target: string;
  label?: string;
  predicate?: string;
}

interface GraphData {
  nodes: InputNode[];
  edges?: InputEdge[];
  links?: InputEdge[];
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

function getColor(node: InputNode): string {
  const cat = node.entityType || node.category || node.type || '';
  return CATEGORY_COLORS[cat] || '#999';
}

function shortLabel(cat: string): string {
  return cat.replace('biolink:', '');
}

export default function KnowledgeGraphView({ content }: ViewerProps) {
  const [view, setView] = useState<'graph' | 'list'>('graph');
  const [selectedNode, setSelectedNode] = useState<ReagraphNode | null>(null);

  const data = useMemo<GraphData | null>(() => {
    try {
      const parsed = JSON.parse(content);
      if (parsed && parsed.nodes) return parsed;
      return null;
    } catch {
      return null;
    }
  }, [content]);

  const { reagraphNodes, reagraphEdges } = useMemo(() => {
    if (!data) return { reagraphNodes: [], reagraphEdges: [] };

    const inputEdges = data.edges || data.links || [];

    const nodes: ReagraphNode[] = data.nodes.map(n => ({
      id: n.id,
      label: n.name || n.label || n.id,
      fill: getColor(n),
      data: { entityType: n.entityType || n.category || n.type },
    }));

    const edges: ReagraphEdge[] = inputEdges.map((e, i) => ({
      id: `edge-${i}`,
      source: e.source,
      target: e.target,
      label: (e.label || e.predicate || '').replace('biolink:', ''),
    }));

    return { reagraphNodes: nodes, reagraphEdges: edges };
  }, [data]);

  if (!data) {
    return (
      <pre className="text-sm bg-zinc-50 dark:bg-zinc-900 rounded-xl p-4 overflow-auto whitespace-pre-wrap font-mono">
        {content}
      </pre>
    );
  }

  const inputEdges = data.edges || data.links || [];
  const categories = [...new Set(data.nodes.map(n => n.entityType || n.category || n.type || 'Unknown'))];

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          <span>{data.nodes.length} nodes</span>
          <span>{inputEdges.length} edges</span>
        </div>
        <div className="flex gap-1 text-xs">
          <button
            onClick={() => setView('graph')}
            className={`px-2 py-0.5 rounded ${view === 'graph' ? 'bg-accent-100 dark:bg-accent-700/20 text-accent-700 dark:text-accent-300' : 'text-zinc-400 hover:text-zinc-600'}`}
          >
            Graph
          </button>
          <button
            onClick={() => setView('list')}
            className={`px-2 py-0.5 rounded ${view === 'list' ? 'bg-accent-100 dark:bg-accent-700/20 text-accent-700 dark:text-accent-300' : 'text-zinc-400 hover:text-zinc-600'}`}
          >
            List
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2">
        {categories.map(cat => (
          <div key={cat} className="flex items-center gap-1.5 text-xs">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: CATEGORY_COLORS[cat] || '#999' }}
            />
            <span className="text-zinc-600 dark:text-zinc-400">{shortLabel(cat)}</span>
          </div>
        ))}
      </div>

      {view === 'graph' ? (
        <>
          {/* Selected node info */}
          {selectedNode && (
            <div className="text-xs bg-zinc-100 dark:bg-zinc-800 rounded px-2 py-1">
              <span className="font-medium">{selectedNode.label}</span>
              <span className="text-zinc-400 ml-2">{shortLabel((selectedNode.data as Record<string, string>)?.entityType || '')}</span>
              <span className="text-zinc-400 ml-2 font-mono">{selectedNode.id}</span>
            </div>
          )}

          {/* Graph */}
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden relative" style={{ height: 450, width: '100%' }}>
            <div style={{ position: 'absolute', inset: 0 }}>
              <GraphCanvas
                nodes={reagraphNodes}
                edges={reagraphEdges}
                layoutType="forceDirected2d"
                onNodeClick={(node) => setSelectedNode(node)}
              />
            </div>
          </div>
        </>
      ) : (
        <>
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
          {inputEdges.length > 0 && (
            <div className="space-y-1 max-h-[200px] overflow-y-auto border-t border-zinc-200 dark:border-zinc-700 pt-3">
              <div className="text-xs font-medium text-zinc-500 uppercase mb-1">Relationships</div>
              {inputEdges.map((edge, i) => {
                const srcNode = data.nodes.find(n => n.id === edge.source);
                const tgtNode = data.nodes.find(n => n.id === edge.target);
                return (
                  <div key={i} className="text-xs text-zinc-600 dark:text-zinc-400 px-2 py-0.5">
                    <span className="font-medium">{srcNode?.name || edge.source}</span>
                    {' '}
                    <span className="text-accent-500">{(edge.label || edge.predicate || '---').replace('biolink:', '')}</span>
                    {' '}
                    <span className="font-medium">{tgtNode?.name || edge.target}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
