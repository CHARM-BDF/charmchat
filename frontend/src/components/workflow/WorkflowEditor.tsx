import { useState } from 'react';
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Save,
  Loader2,
} from 'lucide-react';
import { useMcpStore } from '../../stores/mcpStore';
import type { Workflow, WorkflowNode } from '../../types';
import TraceView from './TraceView';

interface WorkflowEditorProps {
  workflow: Workflow;
  onSave: (workflow: Workflow) => Promise<void>;
}

export default function WorkflowEditor({ workflow, onSave }: WorkflowEditorProps) {
  const [draft, setDraft] = useState<Workflow>(() => JSON.parse(JSON.stringify(workflow)));
  const [saving, setSaving] = useState(false);
  const servers = useMcpStore((s) => s.servers);

  const connectedServers = servers.filter((s) => s.status === 'connected');

  const updateDraft = (patch: Partial<Workflow>) => {
    setDraft((d) => ({ ...d, ...patch }));
  };

  const updateNode = (index: number, patch: Partial<WorkflowNode>) => {
    const nodes = [...draft.nodes];
    nodes[index] = { ...nodes[index], ...patch };
    updateDraft({ nodes });
  };

  const moveNode = (index: number, direction: -1 | 1) => {
    const nodes = [...draft.nodes];
    const target = index + direction;
    if (target < 0 || target >= nodes.length) return;
    [nodes[index], nodes[target]] = [nodes[target], nodes[index]];
    // Re-assign step IDs to match new positions
    nodes.forEach((n, i) => { n.id = `step${i + 1}`; });
    updateDraft({ nodes });
  };

  const addNode = () => {
    const id = `step${draft.nodes.length + 1}`;
    const nodes = [...draft.nodes, { id, tool: '', args: {} }];
    updateDraft({ nodes });
  };

  const removeNode = (index: number) => {
    const nodes = draft.nodes.filter((_, i) => i !== index);
    // Re-assign step IDs
    nodes.forEach((n, i) => { n.id = `step${i + 1}`; });
    updateDraft({ nodes });
  };

  const updateParam = (index: number, patch: { name?: string; description?: string }) => {
    const parameters = [...draft.parameters];
    parameters[index] = { ...parameters[index], ...patch };
    updateDraft({ parameters });
  };

  const addParam = () => {
    updateDraft({ parameters: [...draft.parameters, { name: '', description: '' }] });
  };

  const removeParam = (index: number) => {
    updateDraft({ parameters: draft.parameters.filter((_, i) => i !== index) });
  };

  const updateArg = (nodeIndex: number, oldKey: string, newKey: string, newValue: unknown) => {
    const args = { ...draft.nodes[nodeIndex].args };
    if (oldKey !== newKey) {
      delete args[oldKey];
    }
    args[newKey] = newValue;
    updateNode(nodeIndex, { args });
  };

  const addArg = (nodeIndex: number) => {
    const args = { ...draft.nodes[nodeIndex].args, '': '' };
    updateNode(nodeIndex, { args });
  };

  const removeArg = (nodeIndex: number, key: string) => {
    const args = { ...draft.nodes[nodeIndex].args };
    delete args[key];
    updateNode(nodeIndex, { args });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full px-3 py-1.5 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-accent-500';
  const sectionTitle = 'text-xs font-medium text-zinc-500 uppercase tracking-wider';

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6">
      {/* Name */}
      <div>
        <label className={sectionTitle}>Name</label>
        <input
          type="text"
          value={draft.name}
          onChange={(e) => updateDraft({ name: e.target.value })}
          className={`${inputCls} mt-1`}
        />
      </div>

      {/* Description */}
      <div>
        <label className={sectionTitle}>Description</label>
        <textarea
          value={draft.description}
          onChange={(e) => updateDraft({ description: e.target.value })}
          rows={2}
          className={`${inputCls} mt-1`}
        />
      </div>

      {/* Parameters */}
      <div className="space-y-2">
        <h3 className={sectionTitle}>Parameters</h3>
        {draft.parameters.map((param, i) => (
          <div key={i} className="flex items-start gap-2">
            <input
              type="text"
              value={param.name}
              onChange={(e) => updateParam(i, { name: e.target.value })}
              placeholder="name"
              className={`${inputCls} flex-1`}
            />
            <input
              type="text"
              value={param.description}
              onChange={(e) => updateParam(i, { description: e.target.value })}
              placeholder="description"
              className={`${inputCls} flex-[2]`}
            />
            <button
              onClick={() => removeParam(i)}
              className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-red-500 transition-colors duration-150 mt-0.5"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button
          onClick={addParam}
          className="flex items-center gap-1 text-xs text-accent-600 dark:text-accent-400 hover:underline"
        >
          <Plus size={12} /> Add Parameter
        </button>
      </div>

      {/* Steps */}
      <div className="space-y-3">
        <h3 className={sectionTitle}>Steps ({draft.nodes.length})</h3>
        {draft.nodes.map((node, i) => (
          <div
            key={`${node.id}-${i}`}
            className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-3 space-y-3"
          >
            {/* Step header */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400 w-5 flex-shrink-0">{i + 1}.</span>

              {/* Tool selector */}
              <select
                value={node.tool}
                onChange={(e) => updateNode(i, { tool: e.target.value })}
                className="flex-1 appearance-none bg-white dark:bg-zinc-800 text-sm rounded-lg px-3 py-1.5 border border-zinc-300 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-accent-500 cursor-pointer"
              >
                <option value="">Select tool...</option>
                {/* Show current value if it doesn't match any available tool */}
                {node.tool && !connectedServers.some((s) =>
                  s.tools.some((t) => `${s.name}__${t.name}` === node.tool)
                ) && (
                  <option value={node.tool}>{node.tool}</option>
                )}
                {connectedServers.map((server) => (
                  <optgroup key={server.name} label={server.name}>
                    {server.tools.map((tool) => (
                      <option key={`${server.name}__${tool.name}`} value={`${server.name}__${tool.name}`}>
                        {tool.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>

              {/* Move / Delete controls */}
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <button
                  onClick={() => moveNode(i, -1)}
                  disabled={i === 0}
                  className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 disabled:opacity-30 transition-colors duration-150"
                  title="Move up"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  onClick={() => moveNode(i, 1)}
                  disabled={i === draft.nodes.length - 1}
                  className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 disabled:opacity-30 transition-colors duration-150"
                  title="Move down"
                >
                  <ChevronDown size={14} />
                </button>
                <button
                  onClick={() => removeNode(i)}
                  className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-red-500 transition-colors duration-150"
                  title="Delete step"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {/* Args */}
            <div className="space-y-1.5 pl-7">
              <div className="text-[10px] font-medium text-zinc-500 uppercase">Arguments</div>
              {Object.entries(node.args).map(([key, value], argIdx) => (
                <div key={argIdx} className="flex items-start gap-2">
                  <input
                    type="text"
                    value={key}
                    onChange={(e) => {
                      const entries = Object.entries(node.args);
                      const newArgs: Record<string, unknown> = {};
                      for (const [k, v] of entries) {
                        newArgs[k === key ? e.target.value : k] = v;
                      }
                      updateNode(i, { args: newArgs });
                    }}
                    placeholder="key"
                    className="w-32 px-2 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-accent-500 font-mono"
                  />
                  <textarea
                    value={typeof value === 'string' ? value : JSON.stringify(value)}
                    onChange={(e) => updateArg(i, key, key, e.target.value)}
                    rows={typeof value === 'string' && value.includes('\n') ? Math.min(value.split('\n').length, 6) : 1}
                    placeholder="value"
                    className="flex-1 px-2 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-accent-500 font-mono resize-y"
                  />
                  <button
                    onClick={() => removeArg(i, key)}
                    className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-red-500 transition-colors duration-150"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <button
                onClick={() => addArg(i)}
                className="flex items-center gap-1 text-[11px] text-accent-600 dark:text-accent-400 hover:underline"
              >
                <Plus size={10} /> Add Argument
              </button>
            </div>
          </div>
        ))}
        <button
          onClick={addNode}
          className="flex items-center gap-1.5 text-xs text-accent-600 dark:text-accent-400 hover:underline"
        >
          <Plus size={14} /> Add Step
        </button>
      </div>

      {/* Live DAG preview */}
      {draft.nodes.length > 0 && (
        <div className="space-y-2">
          <h3 className={sectionTitle}>Dependency Graph</h3>
          <div className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
            <TraceView workflowNodes={draft.nodes} />
          </div>
        </div>
      )}

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={saving || !draft.name.trim()}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-accent-600 hover:bg-accent-700 disabled:opacity-50 text-white text-sm font-medium transition-colors duration-150"
      >
        {saving ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Saving...
          </>
        ) : (
          <>
            <Save size={16} />
            Save Workflow
          </>
        )}
      </button>
    </div>
  );
}
