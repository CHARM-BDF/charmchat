import { create } from 'zustand';
import type { Message, Artifact, ConversationMeta, ToolCallDisplay, ToolTraceEntry } from '../types';
import { get, post, put, del } from '../lib/api';
import { parseSSE } from '../lib/sse';
import { useSettingsStore } from './settingsStore';
import { useMcpStore } from './mcpStore';

function generateId(): string {
  return crypto.randomUUID();
}

interface ChatState {
  conversationId: string | null;
  messages: Message[];
  artifacts: Artifact[];
  toolTrace: ToolTraceEntry[];
  conversationList: ConversationMeta[];
  isStreaming: boolean;
  streamingContent: string;
  pendingToolCalls: ToolCallDisplay[];
  error: string | null;
  abortController: AbortController | null;
  artifactPanelVisible: boolean;

  sendMessage: (content: string) => Promise<void>;
  stopStreaming: () => void;
  loadConversation: (id: string) => Promise<void>;
  newConversation: () => void;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, name: string) => Promise<void>;
  fetchConversationList: () => Promise<void>;
  saveConversation: () => Promise<void>;
  setArtifactPanelVisible: (visible: boolean) => void;
}

export const useChatStore = create<ChatState>()((set, getState) => ({
  conversationId: null,
  messages: [],
  artifacts: [],
  toolTrace: [],
  conversationList: [],
  isStreaming: false,
  streamingContent: '',
  pendingToolCalls: [],
  error: null,
  abortController: null,
  artifactPanelVisible: true,

  sendMessage: async (content: string) => {
    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    };

    const currentMessages = [...getState().messages, userMessage];
    set({
      messages: currentMessages,
      isStreaming: true,
      streamingContent: '',
      pendingToolCalls: [],
      error: null,
    });

    const abortController = new AbortController();
    set({ abortController });

    const { provider, model } = useSettingsStore.getState();
    const { blockedServers, blockedTools } = useMcpStore.getState();

    // Send prior messages as history (backend appends the new user message)
    const history = currentMessages.slice(0, -1);

    try {
      const response = (await post(
        '/chat',
        {
          message: content,
          history,
          provider,
          model,
          blockedServers,
          blockedTools,
        },
        { signal: abortController.signal, raw: true }
      )) as unknown as Response;

      let accumulated = '';
      const toolCalls: ToolCallDisplay[] = [];
      const newArtifacts: Artifact[] = [];
      const traceEntries: ToolTraceEntry[] = [];

      for await (const event of parseSSE(response)) {
        if (abortController.signal.aborted) break;

        switch (event.event) {
          case 'delta': {
            const text = (event.data as { content?: string }).content || '';
            accumulated += text;
            set({ streamingContent: accumulated });
            break;
          }
          case 'tool_call': {
            const tc = event.data as { name: string; arguments?: Record<string, unknown>; args?: Record<string, unknown> };
            toolCalls.push({ name: tc.name, args: tc.arguments || tc.args || {} });
            set({ pendingToolCalls: [...toolCalls] });
            break;
          }
          case 'tool_result': {
            const tr = event.data as { name: string; result: unknown };
            const existing = toolCalls.find((t) => t.name === tr.name && !t.result);
            if (existing) {
              existing.result = tr.result;
              set({ pendingToolCalls: [...toolCalls] });
            }
            break;
          }
          case 'artifact': {
            const artifact = event.data as unknown as Artifact;
            console.log('Artifact received:', artifact.type, 'title:', artifact.title, 'content length:', artifact.content?.length, 'content starts:', artifact.content?.substring(0, 60));
            newArtifacts.push(artifact);
            set({ artifacts: [...getState().artifacts, artifact] });
            break;
          }
          case 'trace_entry': {
            const entry = event.data as unknown as ToolTraceEntry;
            traceEntries.push(entry);
            break;
          }
          case 'done': {
            const assistantMessage: Message = {
              id: generateId(),
              role: 'assistant',
              content: accumulated,
              artifactIds: newArtifacts.map((a) => a.id),
              toolCalls: toolCalls.length > 0 ? [...toolCalls] : undefined,
              timestamp: new Date().toISOString(),
            };
            set({
              messages: [...getState().messages, assistantMessage],
              toolTrace: [...getState().toolTrace, ...traceEntries],
              isStreaming: false,
              streamingContent: '',
              pendingToolCalls: [],
              abortController: null,
            });
            // Auto-save
            await getState().saveConversation();
            break;
          }
          case 'error': {
            const errData = event.data as { error?: string; message?: string };
            const errMsg = errData.error || errData.message || 'An error occurred';
            set({ error: errMsg, isStreaming: false, abortController: null });
            break;
          }
        }
      }

      // If stream ended without a 'done' event, finalize
      if (getState().isStreaming) {
        const assistantMessage: Message = {
          id: generateId(),
          role: 'assistant',
          content: accumulated,
          artifactIds: newArtifacts.map((a) => a.id),
          toolCalls: toolCalls.length > 0 ? [...toolCalls] : undefined,
          timestamp: new Date().toISOString(),
        };
        set({
          messages: [...getState().messages, assistantMessage],
          isStreaming: false,
          streamingContent: '',
          pendingToolCalls: [],
          abortController: null,
        });
        await getState().saveConversation();
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // User cancelled — finalize with whatever we have
        const accumulated = getState().streamingContent;
        if (accumulated) {
          const assistantMessage: Message = {
            id: generateId(),
            role: 'assistant',
            content: accumulated,
            timestamp: new Date().toISOString(),
          };
          set({
            messages: [...getState().messages, assistantMessage],
          });
        }
        set({ isStreaming: false, streamingContent: '', pendingToolCalls: [], abortController: null });
      } else {
        set({
          error: (err as Error).message,
          isStreaming: false,
          streamingContent: '',
          pendingToolCalls: [],
          abortController: null,
        });
      }
    }
  },

  stopStreaming: () => {
    const { abortController } = getState();
    if (abortController) {
      abortController.abort();
    }
  },

  loadConversation: async (id: string) => {
    try {
      const data = await get<{
        id: string;
        name: string;
        messages: Message[];
        artifacts: Artifact[];
        toolTrace?: ToolTraceEntry[];
      }>(`/conversations/${id}`);
      set({
        conversationId: data.id,
        messages: data.messages || [],
        artifacts: data.artifacts || [],
        toolTrace: data.toolTrace || [],
        error: null,
        artifactPanelVisible: true,
      });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  newConversation: () => {
    set({
      conversationId: null,
      messages: [],
      artifacts: [],
      toolTrace: [],
      error: null,
      streamingContent: '',
      pendingToolCalls: [],
      artifactPanelVisible: true,
    });
  },

  deleteConversation: async (id: string) => {
    try {
      await del(`/conversations/${id}`);
      if (getState().conversationId === id) {
        getState().newConversation();
      }
      await getState().fetchConversationList();
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  renameConversation: async (id: string, name: string) => {
    try {
      await put(`/conversations/${id}`, { name });
      await getState().fetchConversationList();
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  fetchConversationList: async () => {
    try {
      const data = await get<ConversationMeta[]>('/conversations');
      set({ conversationList: data });
    } catch {
      // Silently fail
    }
  },

  saveConversation: async () => {
    const { conversationId, messages, artifacts, toolTrace } = getState();
    const id = conversationId || generateId();
    const name =
      messages.find((m) => m.role === 'user')?.content.slice(0, 50) || 'New conversation';
    const now = new Date().toISOString();

    try {
      await put(`/conversations/${id}`, {
        id,
        name,
        created: conversationId ? undefined : now,
        updated: now,
        messages,
        artifacts,
        toolTrace: toolTrace.length > 0 ? toolTrace : undefined,
      });
      set({ conversationId: id });
      await getState().fetchConversationList();
    } catch {
      // Silently fail
    }
  },

  setArtifactPanelVisible: (visible: boolean) => {
    set({ artifactPanelVisible: visible });
  },
}));
