import { create } from 'zustand';
import type { Workflow, WorkflowMeta, WorkflowExecution, WorkflowStepStatus } from '../types';
import { get, post, del } from '../lib/api';
import { parseSSE } from '../lib/sse';
import { useSettingsStore } from './settingsStore';

interface WorkflowState {
  workflows: WorkflowMeta[];
  selectedWorkflow: Workflow | null;
  isExecuting: boolean;
  stepStatuses: WorkflowStepStatus[];
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
  stepStatuses: [],
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
    // Initialize all steps as pending
    const workflow = getState().selectedWorkflow;
    const initialSteps: WorkflowStepStatus[] = (workflow?.nodes || []).map(n => ({
      nodeId: n.id,
      tool: n.tool,
      status: 'pending' as const,
    }));
    set({ isExecuting: true, stepStatuses: initialSteps, lastExecution: null });

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

      for await (const event of parseSSE(response)) {
        const steps = [...getState().stepStatuses];

        switch (event.event) {
          case 'tool_call': {
            const { id, name, arguments: args } = event.data as {
              id: string;
              name: string;
              arguments: Record<string, unknown>;
            };
            const step = steps.find(s => s.nodeId === id);
            if (step) {
              step.status = 'running';
              step.tool = name;
              step.args = args;
            }
            set({ stepStatuses: steps });
            break;
          }
          case 'tool_result': {
            const { toolCallId, result, isError, durationMs } = event.data as {
              toolCallId: string;
              name: string;
              result: string;
              isError?: boolean;
              durationMs?: number;
            };
            const step = steps.find(s => s.nodeId === toolCallId);
            if (step) {
              if (isError) {
                step.status = step.status === 'pending' ? 'skipped' : 'error';
                step.error = String(result);
              } else {
                step.status = 'success';
                step.result = String(result);
              }
              if (durationMs !== undefined) {
                step.durationMs = durationMs;
              }
            }
            set({ stepStatuses: steps });
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
      set({ selectedWorkflow: workflow, stepStatuses: [], lastExecution: null });
    } catch {
      // Silently fail
    }
  },

  clearSelection: () => {
    set({ selectedWorkflow: null, stepStatuses: [], lastExecution: null });
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
