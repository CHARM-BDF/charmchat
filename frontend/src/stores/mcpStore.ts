import { create } from 'zustand';
import type { ServerStatus } from '../types';
import { get, post } from '../lib/api';

interface McpState {
  servers: ServerStatus[];
  blockedServers: string[];
  isLoading: boolean;

  fetchStatus: () => Promise<void>;
  toggleServer: (name: string) => void;
  restartServers: () => Promise<void>;
}

export const useMcpStore = create<McpState>()((set, getState) => ({
  servers: [],
  blockedServers: [],
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

  toggleServer: (name) => {
    const { blockedServers } = getState();
    if (blockedServers.includes(name)) {
      set({ blockedServers: blockedServers.filter((s) => s !== name) });
    } else {
      set({ blockedServers: [...blockedServers, name] });
    }
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
