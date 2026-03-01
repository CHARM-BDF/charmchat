import { create } from 'zustand';
import type { Workflow, WorkflowMeta, ToolTraceEntry, WorkflowExecution } from '../types';
import { get, post, del } from '../lib/api';
import { parseSSE } from '../lib/sse';
import { useSettingsStore } from './settingsStore';

interface WorkflowState {
  workflows: WorkflowMeta[];
  selectedWorkflow: Workflow | null;
  isExecuting: boolean;
  executionTrace: ToolTraceEntry[];
  lastExecution: WorkflowExecution | null;

  fetchWorkflows: () => Promise<void>;
  extractWorkflow: (conversationId: string) => Promise<Workflow>;
  executeWorkflow: (workflowId: string, params: Record<string, unknown>) => Promise<void>;
  selectWorkflow: (id: string) => Promise<void>;
  clearSelection: () => void;
  deleteWorkflow: (id: string) => Promise<void>;
}

export const useWorkflowStore = create<WorkflowState>()((set, getState) => ({
  workflows: [],
  selectedWorkflow: null,
  isExecuting: false,
  executionTrace: [],
  lastExecution: null,

  fetchWorkflows: async () => {
    try {
      const data = await get<WorkflowMeta[]>('/workflows');
      set({ workflows: data });
    } catch {
      // Silently fail
    }
  },

  extractWorkflow: async (conversationId: string) => {
    const { provider, model } = useSettingsStore.getState();
    const workflow = await post<Workflow>('/workflows/extract', {
      conversationId,
      provider,
      model,
    });
    await getState().fetchWorkflows();
    return workflow as Workflow;
  },

  executeWorkflow: async (workflowId: string, params: Record<string, unknown>) => {
    set({ isExecuting: true, executionTrace: [], lastExecution: null });

    try {
      const response = await fetch('/api/workflows/' + workflowId + '/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parameters: params }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || response.statusText);
      }

      const traceEntries: ToolTraceEntry[] = [];

      for await (const event of parseSSE(response)) {
        switch (event.event) {
          case 'trace_entry': {
            const entry = event.data as unknown as ToolTraceEntry;
            traceEntries.push(entry);
            set({ executionTrace: [...traceEntries] });
            break;
          }
          case 'done': {
            const { executionId } = event.data as { executionId: string };
            if (executionId) {
              try {
                const execution = await get<WorkflowExecution>(`/executions/${executionId}`);
                set({ lastExecution: execution });
              } catch {
                // non-critical
              }
            }
            break;
          }
          case 'error': {
            const { error } = event.data as { error: string };
            console.error('Workflow execution error:', error);
            break;
          }
        }
      }
    } finally {
      set({ isExecuting: false });
    }
  },

  selectWorkflow: async (id: string) => {
    try {
      const workflow = await get<Workflow>(`/workflows/${id}`);
      set({ selectedWorkflow: workflow, executionTrace: [], lastExecution: null });
    } catch {
      // Silently fail
    }
  },

  clearSelection: () => {
    set({ selectedWorkflow: null, executionTrace: [], lastExecution: null });
  },

  deleteWorkflow: async (id: string) => {
    try {
      await del(`/workflows/${id}`);
      if (getState().selectedWorkflow?.id === id) {
        set({ selectedWorkflow: null });
      }
      await getState().fetchWorkflows();
    } catch {
      // Silently fail
    }
  },
}));
