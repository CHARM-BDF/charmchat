import { useState } from 'react';
import {
  Play,
  Loader2,
  X,
  CheckCircle2,
  XCircle,
  Clock,
  SkipForward,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useWorkflowStore } from '../../stores/workflowStore';
import type { WorkflowStepStatus, WorkflowNode } from '../../types';
import TraceView from './TraceView';

function StepCard({
  node,
  index,
  stepStatus,
}: {
  node: WorkflowNode;
  index: number;
  stepStatus?: WorkflowStepStatus;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = stepStatus?.status || 'pending';

  const toolShort = node.tool.split('__').pop() || node.tool;
  const serverName = node.tool.includes('__') ? node.tool.split('__')[0] : null;

  // Format args for display, showing $ref markers
  const formatArgs = (args: Record<string, unknown>): string => {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(args)) {
      if (value && typeof value === 'object' && '$ref' in (value as Record<string, unknown>)) {
        parts.push(`${key}: \u2190 ${(value as { $ref: string }).$ref}`);
      } else if (typeof value === 'string' && value.length > 60) {
        parts.push(`${key}: "${value.slice(0, 57)}..."`);
      } else {
        parts.push(`${key}: ${JSON.stringify(value)}`);
      }
    }
    return parts.join('\n');
  };

  const statusIcon = {
    pending: <Clock size={14} className="text-zinc-400" />,
    running: <Loader2 size={14} className="text-blue-500 animate-spin" />,
    success: <CheckCircle2 size={14} className="text-green-500" />,
    error: <XCircle size={14} className="text-red-500" />,
    skipped: <SkipForward size={14} className="text-zinc-400" />,
  }[status];

  const borderColor = {
    pending: 'border-zinc-200 dark:border-zinc-700',
    running: 'border-blue-400 dark:border-blue-500',
    success: 'border-green-300 dark:border-green-700',
    error: 'border-red-300 dark:border-red-700',
    skipped: 'border-zinc-200 dark:border-zinc-700',
  }[status];

  const bgColor = {
    pending: 'bg-zinc-50 dark:bg-zinc-800/50',
    running: 'bg-blue-50 dark:bg-blue-900/20',
    success: 'bg-green-50 dark:bg-green-900/10',
    error: 'bg-red-50 dark:bg-red-900/10',
    skipped: 'bg-zinc-50 dark:bg-zinc-800/30',
  }[status];

  // Show resolved args if available, otherwise template args
  const displayArgs = stepStatus?.args || node.args;

  return (
    <div className={`rounded-lg border ${borderColor} ${bgColor} overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2.5 flex items-center gap-2 text-left"
      >
        <span className="text-xs text-zinc-400 w-5 flex-shrink-0">{index + 1}.</span>
        {statusIcon}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium truncate">{toolShort}</span>
            {serverName && (
              <span className="text-[10px] text-zinc-400 bg-zinc-200 dark:bg-zinc-700 rounded px-1">
                {serverName}
              </span>
            )}
          </div>
          {Object.keys(node.args).length > 0 && !expanded && (
            <div className="text-[11px] text-zinc-500 truncate mt-0.5">
              {Object.entries(node.args).map(([k, v]) => {
                if (v && typeof v === 'object' && '$ref' in (v as Record<string, unknown>)) {
                  return `${k}\u2190${(v as { $ref: string }).$ref}`;
                }
                return `${k}=${JSON.stringify(v)}`.slice(0, 30);
              }).join(', ')}
            </div>
          )}
        </div>
        {stepStatus?.durationMs !== undefined && (
          <span className="text-[10px] text-zinc-400 flex-shrink-0">{stepStatus.durationMs}ms</span>
        )}
        {expanded ? (
          <ChevronDown size={14} className="text-zinc-400 flex-shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-zinc-400 flex-shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-zinc-200 dark:border-zinc-700 pt-2">
          {/* Args */}
          {Object.keys(displayArgs).length > 0 && (
            <div>
              <div className="text-[10px] font-medium text-zinc-500 uppercase mb-1">
                {stepStatus?.args ? 'Resolved Args' : 'Template Args'}
              </div>
              <pre className="text-xs bg-zinc-100 dark:bg-zinc-800 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">
                {formatArgs(displayArgs)}
              </pre>
            </div>
          )}

          {/* Result */}
          {stepStatus?.result && (
            <div>
              <div className="text-[10px] font-medium text-zinc-500 uppercase mb-1">Result</div>
              <pre className="text-xs bg-zinc-100 dark:bg-zinc-800 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                {stepStatus.result.length > 1000
                  ? stepStatus.result.slice(0, 1000) + '\n... (truncated)'
                  : stepStatus.result}
              </pre>
            </div>
          )}

          {/* Error */}
          {stepStatus?.error && (
            <div>
              <div className="text-[10px] font-medium text-red-500 uppercase mb-1">Error</div>
              <pre className="text-xs bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">
                {stepStatus.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function WorkflowRunner() {
  const selectedWorkflow = useWorkflowStore((s) => s.selectedWorkflow);
  const isExecuting = useWorkflowStore((s) => s.isExecuting);
  const stepStatuses = useWorkflowStore((s) => s.stepStatuses);
  const lastExecution = useWorkflowStore((s) => s.lastExecution);
  const executeWorkflow = useWorkflowStore((s) => s.executeWorkflow);
  const clearSelection = useWorkflowStore((s) => s.clearSelection);

  const [params, setParams] = useState<Record<string, string>>({});

  if (!selectedWorkflow) return null;

  const handleRun = () => {
    executeWorkflow(selectedWorkflow.id, params);
  };

  const hasResults = stepStatuses.length > 0;
  const successCount = stepStatuses.filter(s => s.status === 'success').length;
  const errorCount = stepStatuses.filter(s => s.status === 'error' || s.status === 'skipped').length;

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Header */}
      <div className="h-14 border-b border-zinc-200 dark:border-zinc-800 flex items-center px-4 justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold truncate">{selectedWorkflow.name}</h2>
          <p className="text-xs text-zinc-500 truncate">{selectedWorkflow.description}</p>
        </div>
        <button
          onClick={clearSelection}
          className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors duration-150 flex-shrink-0"
          title="Close workflow"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Parameters */}
        {selectedWorkflow.parameters.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
              Parameters
            </h3>
            {selectedWorkflow.parameters.map((param) => (
              <div key={param.name}>
                <label className="block text-sm font-medium mb-1">{param.name}</label>
                <p className="text-xs text-zinc-500 mb-1">{param.description}</p>
                <input
                  type="text"
                  value={params[param.name] || ''}
                  onChange={(e) => setParams({ ...params, [param.name]: e.target.value })}
                  className="w-full px-3 py-1.5 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-accent-500"
                  placeholder={param.description}
                />
              </div>
            ))}
          </div>
        )}

        {/* Run button */}
        <button
          onClick={handleRun}
          disabled={isExecuting}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-700 disabled:opacity-50 text-white text-sm font-medium transition-colors duration-150"
        >
          {isExecuting ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Executing...
            </>
          ) : (
            <>
              <Play size={16} />
              Run Workflow
            </>
          )}
        </button>

        {/* Execution summary */}
        {hasResults && !isExecuting && (
          <div className="flex items-center gap-3 text-xs">
            {successCount > 0 && (
              <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                <CheckCircle2 size={12} /> {successCount} succeeded
              </span>
            )}
            {errorCount > 0 && (
              <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                <XCircle size={12} /> {errorCount} failed
              </span>
            )}
          </div>
        )}

        {/* Steps */}
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
            Steps ({selectedWorkflow.nodes.length})
          </h3>
          {selectedWorkflow.nodes.map((node, i) => (
            <StepCard
              key={node.id}
              node={node}
              index={i}
              stepStatus={stepStatuses.find(s => s.nodeId === node.id)}
            />
          ))}
        </div>

        {/* DAG visualization */}
        {lastExecution && (
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
              Execution DAG
            </h3>
            <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
              <TraceView nodeExecutions={lastExecution.nodeExecutions} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
