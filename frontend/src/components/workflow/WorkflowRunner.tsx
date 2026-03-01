import { useState, useEffect } from 'react';
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
  Copy,
  Check,
} from 'lucide-react';
import { useWorkflowStore } from '../../stores/workflowStore';
import type { WorkflowStepStatus, WorkflowNode } from '../../types';
import TraceView from './TraceView';

/** Try to summarize a result for quick display */
function summarizeResult(result: string): { summary: string; detail: string; isJson: boolean } {
  try {
    const parsed = JSON.parse(result);

    // Knowledge graph: { nodes: [...], links: [...] }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      if ('nodes' in parsed && 'links' in parsed) {
        const nodes = parsed.nodes as unknown[];
        const links = parsed.links as unknown[];
        return {
          summary: `Knowledge graph: ${nodes.length} nodes, ${links.length} links`,
          detail: JSON.stringify(parsed, null, 2),
          isJson: true,
        };
      }
      // Generic object: show key count
      const keys = Object.keys(parsed);
      return {
        summary: `Object with ${keys.length} fields: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}`,
        detail: JSON.stringify(parsed, null, 2),
        isJson: true,
      };
    }

    if (Array.isArray(parsed)) {
      return {
        summary: `Array with ${parsed.length} items`,
        detail: JSON.stringify(parsed, null, 2),
        isJson: true,
      };
    }

    return { summary: String(parsed), detail: String(parsed), isJson: false };
  } catch {
    // Plain text — show first few lines as summary
    const lines = result.split('\n').filter(l => l.trim());
    return {
      summary: lines.length > 3
        ? lines.slice(0, 3).join('\n') + `\n... (${lines.length} lines total)`
        : result,
      detail: result,
      isJson: false,
    };
  }
}

function ResultView({ result, maxHeight }: { result: string; maxHeight?: string }) {
  const [showFull, setShowFull] = useState(false);
  const [copied, setCopied] = useState(false);
  const { summary, detail, isJson } = summarizeResult(result);
  const isLarge = detail.length > 2000;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(detail);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] font-medium text-zinc-500 uppercase">Result</div>
        <div className="flex items-center gap-1">
          {isLarge && (
            <button
              onClick={() => setShowFull(!showFull)}
              className="text-[10px] text-accent-600 dark:text-accent-400 hover:underline"
            >
              {showFull ? 'Show summary' : 'Show full'}
            </button>
          )}
          <button
            onClick={handleCopy}
            className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400"
            title="Copy result"
          >
            {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
          </button>
        </div>
      </div>
      {/* Summary line */}
      {isJson && !showFull && (
        <div className="text-xs text-zinc-600 dark:text-zinc-400 mb-1 font-medium">
          {summary}
        </div>
      )}
      <pre
        className={`text-xs bg-zinc-100 dark:bg-zinc-800 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words overflow-y-auto ${maxHeight || 'max-h-64'}`}
      >
        {showFull || !isLarge ? detail : summary}
      </pre>
    </div>
  );
}

function StepCard({
  node,
  index,
  stepStatus,
  defaultExpanded,
}: {
  node: WorkflowNode;
  index: number;
  stepStatus?: WorkflowStepStatus;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded || false);
  const status = stepStatus?.status || 'pending';

  // Auto-expand when defaultExpanded changes
  useEffect(() => {
    if (defaultExpanded) setExpanded(true);
  }, [defaultExpanded]);

  const toolShort = node.tool.split('__').pop() || node.tool;
  const serverName = node.tool.includes('__') ? node.tool.split('__')[0] : null;

  const formatArgs = (args: Record<string, unknown>): string => {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string' && value.length > 80) {
        parts.push(`${key}: "${value.slice(0, 77)}..."`);
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

  const displayArgs = stepStatus?.args || node.args;

  // Collapsed summary of result
  const resultSummary = stepStatus?.result ? summarizeResult(stepStatus.result).summary : null;

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
          {!expanded && (
            <div className="text-[11px] text-zinc-500 truncate mt-0.5">
              {status === 'success' && resultSummary
                ? resultSummary.split('\n')[0]
                : status === 'error' && stepStatus?.error
                  ? stepStatus.error.slice(0, 80)
                  : Object.entries(node.args).map(([k, v]) =>
                      `${k}=${JSON.stringify(v)}`.slice(0, 30)
                    ).join(', ')}
            </div>
          )}
        </div>
        {stepStatus?.durationMs !== undefined && stepStatus.durationMs > 0 && (
          <span className="text-[10px] text-zinc-400 flex-shrink-0">
            {stepStatus.durationMs > 1000
              ? `${(stepStatus.durationMs / 1000).toFixed(1)}s`
              : `${stepStatus.durationMs}ms`}
          </span>
        )}
        {expanded ? (
          <ChevronDown size={14} className="text-zinc-400 flex-shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-zinc-400 flex-shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-zinc-200 dark:border-zinc-700 pt-2">
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

          {stepStatus?.result && <ResultView result={stepStatus.result} />}

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

/** Final results panel shown after execution */
function ExecutionResults({
  stepStatuses,
  nodes,
}: {
  stepStatuses: WorkflowStepStatus[];
  nodes: WorkflowNode[];
}) {
  const successSteps = stepStatuses.filter(s => s.status === 'success' && s.result);
  if (successSteps.length === 0) return null;

  // Show the last successful step's result prominently
  const lastStep = successSteps[successSteps.length - 1];
  const lastNode = nodes.find(n => n.id === lastStep.nodeId);
  const toolName = lastNode?.tool.split('__').pop() || lastStep.tool;

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
        Final Output — {toolName}
      </h3>
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3">
        <ResultView result={lastStep.result!} maxHeight="max-h-[500px]" />
      </div>

      {/* Summary of all steps */}
      {successSteps.length > 1 && (
        <div className="text-xs text-zinc-500 space-y-1">
          <div className="font-medium uppercase text-[10px] tracking-wider">Pipeline Summary</div>
          {successSteps.map((step) => {
            const node = nodes.find(n => n.id === step.nodeId);
            const name = node?.tool.split('__').pop() || step.tool;
            const { summary } = summarizeResult(step.result!);
            return (
              <div key={step.nodeId} className="flex items-start gap-2">
                <CheckCircle2 size={12} className="text-green-500 mt-0.5 flex-shrink-0" />
                <span>
                  <span className="font-medium">{name}</span>
                  {' — '}
                  <span className="text-zinc-400">{summary.split('\n')[0]}</span>
                </span>
              </div>
            );
          })}
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
  const isDone = hasResults && !isExecuting;
  const successCount = stepStatuses.filter(s => s.status === 'success').length;
  const errorCount = stepStatuses.filter(s => s.status === 'error' || s.status === 'skipped').length;

  // Find last successful step to auto-expand
  const lastSuccessId = isDone
    ? [...stepStatuses].reverse().find(s => s.status === 'success')?.nodeId
    : undefined;

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Header */}
      <div className="h-14 border-b border-zinc-200 dark:border-zinc-800 flex items-center px-4 justify-between">
        <h2 className="text-sm font-semibold truncate">{selectedWorkflow.name}</h2>
        <button
          onClick={clearSelection}
          className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors duration-150 flex-shrink-0"
          title="Close workflow"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <p className="text-xs text-zinc-500">{selectedWorkflow.description}</p>
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

        {/* Execution summary bar */}
        {isDone && (
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

        {/* Final output — shown prominently after execution */}
        {isDone && (
          <ExecutionResults
            stepStatuses={stepStatuses}
            nodes={selectedWorkflow.nodes}
          />
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
              defaultExpanded={isDone && node.id === lastSuccessId}
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
