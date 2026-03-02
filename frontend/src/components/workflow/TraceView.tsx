import type { ToolTraceEntry, NodeExecution, WorkflowNode } from '../../types';
import MermaidDiagram from '../artifacts/MermaidDiagram';

interface TraceViewProps {
  trace?: ToolTraceEntry[];
  nodeExecutions?: NodeExecution[];
  workflowNodes?: WorkflowNode[];
}

function sanitizeLabel(text: string): string {
  return text.replace(/["\[\](){}]/g, '').slice(0, 40);
}

/** Extract step references like {{step1.field}} from workflow node args */
function extractStepRefs(args: Record<string, unknown>): Set<string> {
  const refs = new Set<string>();
  const pattern = /\{\{(step\d+)(?:\.[^}]*)?\}\}/g;
  function walk(val: unknown) {
    if (typeof val === 'string') {
      let m;
      while ((m = pattern.exec(val)) !== null) {
        refs.add(m[1]);
      }
    } else if (val && typeof val === 'object') {
      for (const v of Object.values(val as Record<string, unknown>)) {
        walk(v);
      }
    }
  }
  walk(args);
  return refs;
}

export default function TraceView({ trace, nodeExecutions, workflowNodes }: TraceViewProps) {
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
  } else if (workflowNodes && workflowNodes.length > 0) {
    // Workflow definition preview — parse template refs for edges
    const lines = ['graph TD'];
    const nodeIds = new Set(workflowNodes.map(n => n.id));

    for (const node of workflowNodes) {
      const label = sanitizeLabel(node.tool.split('__').pop() || node.tool);
      lines.push(`    ${node.id}["${label}"]`);
    }

    for (const node of workflowNodes) {
      const refs = extractStepRefs(node.args);
      for (const ref of refs) {
        if (nodeIds.has(ref)) {
          lines.push(`    ${ref} --> ${node.id}`);
        }
      }
    }

    // Neutral styling
    for (const node of workflowNodes) {
      lines.push(`    style ${node.id} fill:#e0e7ff,stroke:#6366f1`);
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
