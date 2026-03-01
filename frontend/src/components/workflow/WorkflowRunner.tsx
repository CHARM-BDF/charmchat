import { useState } from 'react';
import { Play, Loader2, X } from 'lucide-react';
import { useWorkflowStore } from '../../stores/workflowStore';
import TraceView from './TraceView';

export default function WorkflowRunner() {
  const selectedWorkflow = useWorkflowStore((s) => s.selectedWorkflow);
  const isExecuting = useWorkflowStore((s) => s.isExecuting);
  const executionTrace = useWorkflowStore((s) => s.executionTrace);
  const lastExecution = useWorkflowStore((s) => s.lastExecution);
  const executeWorkflow = useWorkflowStore((s) => s.executeWorkflow);
  const clearSelection = useWorkflowStore((s) => s.clearSelection);

  const [params, setParams] = useState<Record<string, string>>({});

  if (!selectedWorkflow) return null;

  const handleRun = () => {
    executeWorkflow(selectedWorkflow.id, params);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Header */}
      <div className="h-14 border-b border-zinc-200 dark:border-zinc-800 flex items-center px-4 justify-between">
        <div>
          <h2 className="text-sm font-semibold">{selectedWorkflow.name}</h2>
          <p className="text-xs text-zinc-500">{selectedWorkflow.description}</p>
        </div>
        <button
          onClick={clearSelection}
          className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors duration-150"
          title="Close workflow"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Parameters */}
        {selectedWorkflow.parameters.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Parameters</h3>
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

        {/* Nodes preview */}
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
            Steps ({selectedWorkflow.nodes.length})
          </h3>
          {selectedWorkflow.nodes.map((node, i) => (
            <div
              key={node.id}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-sm"
            >
              <span className="text-xs text-zinc-400 w-5">{i + 1}.</span>
              <span className="font-mono text-xs">
                {node.tool.split('__').pop() || node.tool}
              </span>
            </div>
          ))}
        </div>

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

        {/* Execution trace */}
        {executionTrace.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
              Execution Trace
            </h3>
            {executionTrace.map((entry) => (
              <div
                key={entry.id}
                className="px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-xs"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono font-medium">
                    {entry.tool.split('__').pop() || entry.tool}
                  </span>
                  <span className="text-zinc-400">{entry.durationMs}ms</span>
                </div>
                <pre className="text-zinc-500 truncate max-w-full">
                  {typeof entry.result === 'string'
                    ? entry.result.slice(0, 120)
                    : JSON.stringify(entry.result).slice(0, 120)}
                </pre>
              </div>
            ))}
          </div>
        )}

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
