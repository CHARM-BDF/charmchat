import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProviderName } from '../types';
import { get, put } from '../lib/api';

const DEFAULT_MODELS: Record<ProviderName, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  bedrock: 'global.anthropic.claude-sonnet-4-6',
  openai: 'gpt-4o',
  gemini: 'gemini-2.0-flash',
  vertex: 'gemini-2.5-flash',
  ollama: 'llama3.2',
};

interface SettingsState {
  provider: ProviderName;
  model: string;
  theme: 'light' | 'dark' | 'system';
  apiKeys: Partial<Record<ProviderName, string>>;
  models: Record<ProviderName, string[]>;

  setProvider: (provider: ProviderName) => void;
  setModel: (model: string) => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  setApiKey: (provider: ProviderName, key: string) => void;
  fetchModels: () => Promise<void>;
  loadSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;
}

function applyTheme(theme: 'light' | 'dark' | 'system') {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else if (theme === 'light') {
    root.classList.remove('dark');
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, getState) => ({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      theme: 'light',
      apiKeys: {},
      models: {
        anthropic: [],
        bedrock: [],
        openai: [],
        gemini: [],
        vertex: [],
        ollama: [],
      },

      setProvider: (provider) => {
        const model = DEFAULT_MODELS[provider];
        set({ provider, model });
      },

      setModel: (model) => {
        set({ model });
      },

      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },

      setApiKey: async (provider, key) => {
        const apiKeys = { ...getState().apiKeys, [provider]: key };
        set({ apiKeys });
        try {
          await put('/settings', {
            provider: getState().provider,
            model: getState().model,
            theme: getState().theme,
            apiKeys,
          });
        } catch {
          // Silently fail — local state is updated
        }
      },

      fetchModels: async () => {
        try {
          const data = await get<Record<ProviderName, string[]>>('/models');
          set({ models: data });
        } catch {
          // Keep defaults
        }
      },

      loadSettings: async () => {
        try {
          const data = await get<{
            provider?: ProviderName;
            model?: string;
            theme?: 'light' | 'dark' | 'system';
            apiKeys?: Partial<Record<ProviderName, string>>;
          }>('/settings');
          const state = getState();
          const merged = {
            provider: data.provider || state.provider,
            model: data.model || state.model,
            theme: state.theme, // Keep local theme preference
            apiKeys: { ...state.apiKeys, ...data.apiKeys },
          };
          set(merged);
          applyTheme(merged.theme);
        } catch {
          // Use local persisted state
          applyTheme(getState().theme);
        }
      },

      saveSettings: async () => {
        const { provider, model, theme, apiKeys } = getState();
        await put('/settings', { provider, model, theme, apiKeys });
      },
    }),
    {
      name: 'charmgpt2-settings',
      partialize: (state) => ({
        provider: state.provider,
        model: state.model,
        theme: state.theme,
        apiKeys: state.apiKeys,
      }),
    }
  )
);
