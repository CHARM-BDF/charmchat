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
  byok: boolean;
  byokProviders: ProviderName[];
  fixedModel: string | null;

  setProvider: (provider: ProviderName) => void;
  setModel: (model: string) => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  setApiKey: (provider: ProviderName, key: string) => void;
  fetchModels: () => Promise<void>;
  loadSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;
}

function isByokForProvider(provider: ProviderName, byok: boolean, byokProviders: ProviderName[]): boolean {
  return byok && byokProviders.includes(provider);
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
      byok: false,
      byokProviders: [],
      fixedModel: null,

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
        const trimmed = key.trim();
        const apiKeys = { ...getState().apiKeys, [provider]: trimmed };
        set({ apiKeys });
        // In BYOK mode for this provider, never send the key to the server.
        const state = getState();
        if (isByokForProvider(provider, state.byok, state.byokProviders)) {
          return;
        }
        try {
          await put('/settings', {
            provider: state.provider,
            model: state.model,
            theme: state.theme,
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

          // If only one provider/model is available, auto-select it
          const providers = Object.keys(data) as ProviderName[];
          if (providers.length === 1) {
            const p = providers[0];
            const modelList = data[p];
            if (modelList && modelList.length === 1) {
              set({ provider: p, model: modelList[0] });
            }
          }
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
            byok?: boolean;
            byokProviders?: ProviderName[];
            fixedModel?: string | null;
          }>('/settings');
          const state = getState();
          const byok = data.byok === true;
          const byokProviders = data.byokProviders || [];
          // In BYOK mode, ignore any apiKeys the server might return (it shouldn't).
          // Trust only the local-persisted apiKeys for BYOK providers.
          const mergedKeys: Partial<Record<ProviderName, string>> = byok
            ? { ...state.apiKeys }
            : { ...state.apiKeys, ...data.apiKeys };
          const merged = {
            provider: data.provider || state.provider,
            model: data.model || state.model,
            theme: state.theme, // Keep local theme preference
            apiKeys: mergedKeys,
            byok,
            byokProviders,
            fixedModel: data.fixedModel ?? null,
          };
          set(merged);
          applyTheme(merged.theme);
        } catch {
          // Use local persisted state
          applyTheme(getState().theme);
        }
      },

      saveSettings: async () => {
        const { provider, model, theme, apiKeys, byok } = getState();
        // Don't persist apiKeys server-side in BYOK mode.
        await put('/settings', {
          provider,
          model,
          theme,
          apiKeys: byok ? {} : apiKeys,
        });
      },
    }),
    {
      name: 'charmchat-settings',
      partialize: (state) => ({
        provider: state.provider,
        model: state.model,
        theme: state.theme,
        apiKeys: state.apiKeys,
      }),
    }
  )
);
