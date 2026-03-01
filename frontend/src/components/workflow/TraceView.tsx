import type { ToolTraceEntry, NodeExecution } from '../../types';
import MermaidDiagram from '../artifacts/MermaidDiagram';

interface TraceViewProps {
  trace?: ToolTraceEntry[];
  nodeExecutions?: NodeExecution[];
}

function sanitizeLabel(text: string): string {
  return text.replace(/["\[\](){}]/g, '').slice(0, 40);
}

export default function TraceView({ trace, nodeExecutions }: TraceViewProps) {
  let mermaidCode: string;

  if (nodeExecutions && nodeExecutions.length > 0) {
    // Workflow execution — use argSources for edges
    const lines = ['graph TD'];

    for (const node of nodeExecutions) {
      const label = sanitizeLabel(node.tool.split('__').pop() || node.tool);
      const statusIcon = node.status === 'success' ? '✓' : '✗';
      lines.push(`    ${node.nodeId}["${statusIcon} ${label}<br/>${node.durationMs}ms"]`);
    }

    // Build edges from argSources
    const nodeIds = new Set(nodeExecutions.map(n => n.nodeId));
    for (const node of nodeExecutions) {
      for (const [arg, source] of Object.entries(node.argSources)) {
        const sourceNode = source.split('.')[0];
        if (sourceNode !== '$input' && nodeIds.has(sourceNode)) {
          lines.push(`    ${sourceNode} -->|${sanitizeLabel(arg)}| ${node.nodeId}`);
        }
      }
    }

    // Style nodes by status
    for (const node of nodeExecutions) {
      if (node.status === 'error') {
        lines.push(`    style ${node.nodeId} fill:#fecaca,stroke:#dc2626`);
      } else {
        lines.push(`    style ${node.nodeId} fill:#bbf7d0,stroke:#16a34a`);
      }
    }

    mermaidCode = lines.join('\n');
  } else if (trace && trace.length > 0) {
    // Chat trace — sequential nodes
    const lines = ['graph TD'];

    for (let i = 0; i < trace.length; i++) {
      const entry = trace[i];
      const label = sanitizeLabel(entry.tool.split('__').pop() || entry.tool);
      lines.push(`    step${i}["${label}<br/>${entry.durationMs}ms"]`);
      if (i > 0) {
        lines.push(`    step${i - 1} --> step${i}`);
      }
    }

    mermaidCode = lines.join('\n');
  } else {
    return (
      <div className="text-sm text-zinc-400 dark:text-zinc-600 py-4 text-center">
        No trace data available
      </div>
    );
  }

  return <MermaidDiagram content={mermaidCode} />;
}
