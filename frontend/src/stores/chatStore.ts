import { create } from 'zustand';
import type { Message, Artifact, ConversationMeta, ToolCallDisplay, ToolTraceEntry, ProvenanceReport, CounterReport } from '../types';
import { get, post, put, del } from '../lib/api';
import { parseSSE } from '../lib/sse';
import { useSettingsStore } from './settingsStore';
import { useMcpStore } from './mcpStore';

function generateId(): string {
  return crypto.randomUUID();
}

function stripArtifactTags(content: string): string {
  return content.replace(/<artifact[\s\S]*?<\/artifact>/g, '').trim();
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
  sendChallenge: (content: string, target: 'message' | 'transcript') => Promise<void>;
  stopStreaming: () => void;
  loadConversation: (id: string) => Promise<void>;
  newConversation: () => void;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, name: string) => Promise<void>;
  fetchConversationList: () => Promise<void>;
  saveConversation: () => Promise<void>;
  rateMessage: (messageId: string, rating: 'like' | 'dislike') => Promise<void>;
  saveChallengeResult: (messageId: string, counterReport: CounterReport, toolCalls: ToolCallDisplay[]) => Promise<void>;
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

    const { provider, model, apiKeys, byok, byokProviders } = useSettingsStore.getState();
    const { blockedServers, blockedTools } = useMcpStore.getState();

    // In BYOK mode for this provider, include the locally-stored key in the
    // request body. Otherwise the server uses its own credentials.
    const includeKey = byok && byokProviders.includes(provider);
    const apiKey = includeKey ? apiKeys[provider]?.trim() : undefined;

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
          ...(apiKey ? { apiKey } : {}),
        },
        { signal: abortController.signal, raw: true }
      )) as unknown as Response;

      let accumulated = '';
      const toolCalls: ToolCallDisplay[] = [];
      const newArtifacts: Artifact[] = [];
      const traceEntries: ToolTraceEntry[] = [];
      let provenanceReport: ProvenanceReport | undefined;

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
          case 'provenance': {
            provenanceReport = event.data as unknown as ProvenanceReport;
            break;
          }
          case 'done': {
            // Use content from done event (provenance block stripped) if available,
            // otherwise fall back to accumulated deltas
            const doneContent = (event.data as { content?: string }).content || accumulated;
            const assistantMessage: Message = {
              id: generateId(),
              role: 'assistant',
              content: doneContent,
              artifactIds: newArtifacts.map((a) => a.id),
              toolCalls: toolCalls.length > 0 ? [...toolCalls] : undefined,
              timestamp: new Date().toISOString(),
              provenanceReport,
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

  // Picrophant in conversational form: run an adversarial challenge and append
  // the counter-report as an assistant reply. `target: 'message'` challenges the
  // text the user just typed (it IS the report); `target: 'transcript'` challenges
  // the most recent assistant reply, with any typed text used as a focus hint.
  sendChallenge: async (content: string, target: 'message' | 'transcript') => {
    const trimmed = content.trim();
    const baseMessages = [...getState().messages];

    let report = '';
    let claims: string[] = [];
    let focus: string | undefined;

    if (target === 'message') {
      if (!trimmed) return;
      report = trimmed;
    } else {
      const lastAssistant = [...baseMessages].reverse().find((m) => m.role === 'assistant');
      if (!lastAssistant) {
        set({ error: 'Nothing to challenge yet — send a message first.' });
        return;
      }
      report = stripArtifactTags(lastAssistant.content);
      claims = lastAssistant.provenanceReport?.claims.map((c) => c.claim) ?? [];
      focus = trimmed || undefined;
    }

    // Show the user's typed text as a normal user turn (if any was typed).
    const userTurn: Message[] = trimmed
      ? [{ id: generateId(), role: 'user', content: trimmed, timestamp: new Date().toISOString() }]
      : [];

    set({
      messages: [...baseMessages, ...userTurn],
      isStreaming: true,
      streamingContent:
        target === 'message' ? 'Challenging this message…' : 'Challenging the previous report…',
      pendingToolCalls: [],
      error: null,
    });

    const abortController = new AbortController();
    set({ abortController });

    const { provider, model, apiKeys, byok, byokProviders } = useSettingsStore.getState();
    const includeKey = byok && byokProviders.includes(provider);
    const apiKey = includeKey ? apiKeys[provider]?.trim() : undefined;

    try {
      const response = (await post(
        '/picrophant/challenge',
        {
          report,
          claims,
          ...(focus ? { focus } : {}),
          provider,
          model,
          ...(apiKey ? { apiKey } : {}),
        },
        { signal: abortController.signal, raw: true }
      )) as unknown as Response;

      const toolCalls: ToolCallDisplay[] = [];
      let counterReport: CounterReport | null = null;

      for await (const event of parseSSE(response)) {
        if (abortController.signal.aborted) break;
        const data = event.data as Record<string, unknown>;

        switch (event.event) {
          case 'status':
            set({ streamingContent: String(data.message || '') });
            break;
          case 'tool_call': {
            const tc = data as { name: string; args?: Record<string, unknown> };
            toolCalls.push({ name: tc.name, args: tc.args || {} });
            set({ pendingToolCalls: [...toolCalls] });
            break;
          }
          case 'tool_result': {
            const tr = data as { name: string; result: unknown };
            const existing = toolCalls.find((t) => t.name === tr.name && t.result === undefined);
            if (existing) {
              existing.result = tr.result;
              set({ pendingToolCalls: [...toolCalls] });
            }
            break;
          }
          case 'done': {
            counterReport = data.counterReport as CounterReport;
            const assistantMessage: Message = {
              id: generateId(),
              role: 'assistant',
              content: '',
              counterReport,
              challengeToolCalls: toolCalls.length > 0 ? [...toolCalls] : undefined,
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
            break;
          }
          case 'error':
            set({
              error: String(data.error || 'Challenge failed'),
              isStreaming: false,
              streamingContent: '',
              pendingToolCalls: [],
              abortController: null,
            });
            break;
        }
      }

      // Stream ended without a terminal event.
      if (getState().isStreaming) {
        set({
          isStreaming: false,
          streamingContent: '',
          pendingToolCalls: [],
          abortController: null,
          ...(counterReport ? {} : { error: 'No counter-report produced.' }),
        });
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
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

  rateMessage: async (messageId: string, rating: 'like' | 'dislike') => {
    const messages = getState().messages.map((m) =>
      m.id === messageId ? { ...m, rating: m.rating === rating ? undefined : rating } : m,
    );
    set({ messages });
    await getState().saveConversation();
  },

  saveChallengeResult: async (messageId: string, counterReport: CounterReport, toolCalls: ToolCallDisplay[]) => {
    const messages = getState().messages.map((m) =>
      m.id === messageId ? { ...m, counterReport, challengeToolCalls: toolCalls } : m,
    );
    set({ messages });
    await getState().saveConversation();
  },

  setArtifactPanelVisible: (visible: boolean) => {
    set({ artifactPanelVisible: visible });
  },
}));
