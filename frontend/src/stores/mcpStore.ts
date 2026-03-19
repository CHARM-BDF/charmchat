import { create } from 'zustand';
import type { ServerStatus } from '../types';
import { get, post, put } from '../lib/api';

interface McpState {
  servers: ServerStatus[];
  blockedServers: string[];
  blockedTools: string[];
  isLoading: boolean;

  fetchStatus: () => Promise<void>;
  loadBlockedState: () => Promise<void>;
  toggleServer: (name: string) => Promise<void>;
  toggleAllTools: (serverName: string) => Promise<void>;
  toggleTool: (qualifiedName: string) => Promise<void>;
  restartServers: () => Promise<void>;
}

async function persistBlocked(blockedServers: string[], blockedTools: string[]) {
  try {
    const settings = await get<Record<string, unknown>>('/settings');
    await put('/settings', { ...settings, blockedServers, blockedTools });
  } catch {
    // Silently fail — local state is updated
  }
}

export const useMcpStore = create<McpState>()((set, getState) => ({
  servers: [],
  blockedServers: [],
  blockedTools: [],
  isLoading: false,

  fetchStatus: async () => {
    set({ isLoading: true });
    try {
      const data = await get<{ servers: ServerStatus[] }>('/mcp');
      set({ servers: data.servers || [], isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  loadBlockedState: async () => {
    try {
      const settings = await get<{ blockedServers?: string[]; blockedTools?: string[] }>('/settings');
      set({
        blockedServers: settings.blockedServers || [],
        blockedTools: settings.blockedTools || [],
      });
    } catch {
      // Keep defaults
    }
  },

  toggleServer: async (name) => {
    const { blockedServers, blockedTools } = getState();
    const next = blockedServers.includes(name)
      ? blockedServers.filter((s) => s !== name)
      : [...blockedServers, name];
    set({ blockedServers: next });
    await persistBlocked(next, blockedTools);
  },

  toggleAllTools: async (serverName) => {
    const { servers, blockedServers, blockedTools } = getState();
    const server = servers.find((s) => s.name === serverName);
    if (!server) return;
    const toolNames = server.tools.map((t) => t.name);
    const allBlocked = toolNames.every((t) => blockedTools.includes(t));
    const next = allBlocked
      ? blockedTools.filter((t) => !toolNames.includes(t))
      : [...blockedTools, ...toolNames.filter((t) => !blockedTools.includes(t))];
    set({ blockedTools: next });
    await persistBlocked(blockedServers, next);
  },

  toggleTool: async (qualifiedName) => {
    const { blockedServers, blockedTools } = getState();
    const next = blockedTools.includes(qualifiedName)
      ? blockedTools.filter((t) => t !== qualifiedName)
      : [...blockedTools, qualifiedName];
    set({ blockedTools: next });
    await persistBlocked(blockedServers, next);
  },

  restartServers: async () => {
    set({ isLoading: true });
    try {
      await post('/mcp/restart');
      await getState().fetchStatus();
    } catch {
      set({ isLoading: false });
    }
  },
}));
