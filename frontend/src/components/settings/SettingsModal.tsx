import { useState } from 'react';
import {
  X,
  Sun,
  Moon,
  Monitor,
  Eye,
  EyeOff,
  RefreshCw,
  ChevronDown,
} from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useMcpStore } from '../../stores/mcpStore';
import type { ProviderName } from '../../types';

const PROVIDER_LABELS: Record<ProviderName, string> = {
  anthropic: 'Anthropic',
  bedrock: 'Bedrock',
  openai: 'OpenAI',
  gemini: 'Gemini',
  ollama: 'Ollama',
};

const PROVIDERS: ProviderName[] = ['anthropic', 'bedrock', 'openai', 'gemini', 'ollama'];
const API_KEY_PROVIDERS: ProviderName[] = ['anthropic', 'openai', 'gemini'];

interface Props {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: Props) {
  const theme = useSettingsStore((s) => s.theme);
  const provider = useSettingsStore((s) => s.provider);
  const model = useSettingsStore((s) => s.model);
  const models = useSettingsStore((s) => s.models);
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setProvider = useSettingsStore((s) => s.setProvider);
  const setModel = useSettingsStore((s) => s.setModel);
  const setApiKey = useSettingsStore((s) => s.setApiKey);

  const servers = useMcpStore((s) => s.servers);
  const blockedServers = useMcpStore((s) => s.blockedServers);
  const blockedTools = useMcpStore((s) => s.blockedTools);
  const isLoadingMcp = useMcpStore((s) => s.isLoading);
  const toggleServer = useMcpStore((s) => s.toggleServer);
  const toggleTool = useMcpStore((s) => s.toggleTool);
  const restartServers = useMcpStore((s) => s.restartServers);

  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [localKeys, setLocalKeys] = useState<Partial<Record<ProviderName, string>>>(
    () => ({ ...apiKeys })
  );
  const [expandedServer, setExpandedServer] = useState<string | null>(null);

  const toggleShowKey = (p: string) => {
    setShowKeys((prev) => ({ ...prev, [p]: !prev[p] }));
  };

  const handleSaveKeys = () => {
    for (const p of API_KEY_PROVIDERS) {
      const val = localKeys[p];
      if (val !== undefined && val !== apiKeys[p]) {
        setApiKey(p, val);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  const availableModels = models[provider] || [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative max-w-lg w-full mx-4 bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-150"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-8">
          {/* General */}
          <section>
            <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
              General
            </h3>

            {/* Theme */}
            <div className="mb-4">
              <label className="text-sm font-medium mb-2 block">Theme</label>
              <div className="flex gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-xl p-1">
                {(
                  [
                    { value: 'light' as const, icon: Sun, label: 'Light' },
                    { value: 'dark' as const, icon: Moon, label: 'Dark' },
                    { value: 'system' as const, icon: Monitor, label: 'System' },
                  ] as const
                ).map(({ value, icon: Icon, label }) => (
                  <button
                    key={value}
                    onClick={() => setTheme(value)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-colors duration-150 ${
                      theme === value
                        ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                    }`}
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Default Provider */}
            <div className="mb-4">
              <label className="text-sm font-medium mb-2 block">Default Provider</label>
              <div className="relative">
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as ProviderName)}
                  className="w-full appearance-none bg-zinc-100 dark:bg-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 transition-colors duration-150 cursor-pointer"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {PROVIDER_LABELS[p]}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={14}
                  className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400"
                />
              </div>
            </div>

            {/* Default Model */}
            <div>
              <label className="text-sm font-medium mb-2 block">Default Model</label>
              <div className="relative">
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full appearance-none bg-zinc-100 dark:bg-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 transition-colors duration-150 cursor-pointer"
                >
                  <option value={model}>{model}</option>
                  {availableModels
                    .filter((m) => m !== model)
                    .map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                </select>
                <ChevronDown
                  size={14}
                  className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400"
                />
              </div>
            </div>
          </section>

          {/* API Keys */}
          <section>
            <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
              API Keys
            </h3>
            <div className="space-y-3">
              {API_KEY_PROVIDERS.map((p) => (
                <div key={p}>
                  <label className="text-sm font-medium mb-1.5 block">
                    {PROVIDER_LABELS[p]}
                  </label>
                  <div className="relative">
                    <input
                      type={showKeys[p] ? 'text' : 'password'}
                      value={localKeys[p] || ''}
                      onChange={(e) =>
                        setLocalKeys((prev) => ({ ...prev, [p]: e.target.value }))
                      }
                      placeholder={`Enter ${PROVIDER_LABELS[p]} API key`}
                      className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-xl px-4 py-2.5 pr-10 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent-500 transition-colors duration-150"
                    />
                    <button
                      onClick={() => toggleShowKey(p)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                    >
                      {showKeys[p] ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              ))}
              <button
                onClick={handleSaveKeys}
                className="w-full bg-accent-500 hover:bg-accent-600 text-white text-sm font-medium rounded-xl px-4 py-2.5 transition-colors duration-150"
              >
                Save API Keys
              </button>
            </div>
          </section>

          {/* MCP Servers */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                MCP Servers
              </h3>
              <button
                onClick={restartServers}
                disabled={isLoadingMcp}
                className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors duration-150 disabled:opacity-50"
              >
                <RefreshCw size={12} className={isLoadingMcp ? 'animate-spin' : ''} />
                <span>Restart</span>
              </button>
            </div>

            {servers.length === 0 ? (
              <p className="text-sm text-zinc-400 dark:text-zinc-600">
                No MCP servers configured
              </p>
            ) : (
              <div className="space-y-2">
                {servers.map((server) => {
                  const isServerBlocked = blockedServers.includes(server.name);
                  const statusColor =
                    isServerBlocked
                      ? 'bg-zinc-400'
                      : server.status === 'connected'
                        ? 'bg-emerald-500'
                        : server.status === 'error'
                          ? 'bg-red-500'
                          : 'bg-zinc-400';

                  return (
                    <div
                      key={server.name}
                      className={`bg-zinc-100 dark:bg-zinc-800 rounded-xl overflow-hidden ${isServerBlocked ? 'opacity-60' : ''}`}
                    >
                      <div className="w-full flex items-center gap-2 px-4 py-2.5 text-sm">
                        <div className={`w-2 h-2 rounded-full ${statusColor}`} />
                        <button
                          onClick={() =>
                            setExpandedServer(
                              expandedServer === server.name ? null : server.name
                            )
                          }
                          className="font-medium flex-1 text-left"
                        >
                          {server.name}
                        </button>
                        <span className="text-xs text-zinc-400">
                          {server.tools.length} tool{server.tools.length !== 1 ? 's' : ''}
                        </span>
                        <button
                          onClick={() => toggleServer(server.name)}
                          className={`w-7 h-4 rounded-full relative transition-colors duration-150 flex-shrink-0 ${
                            !isServerBlocked
                              ? 'bg-accent-500'
                              : 'bg-zinc-300 dark:bg-zinc-600'
                          }`}
                          title={isServerBlocked ? 'Enable server' : 'Disable server'}
                        >
                          <div
                            className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform duration-150 ${
                              !isServerBlocked ? 'translate-x-3.5' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                        <ChevronDown
                          size={14}
                          className={`text-zinc-400 transition-transform duration-150 cursor-pointer ${
                            expandedServer === server.name ? 'rotate-180' : ''
                          }`}
                          onClick={() =>
                            setExpandedServer(
                              expandedServer === server.name ? null : server.name
                            )
                          }
                        />
                      </div>
                      {expandedServer === server.name && (
                        <div className="px-4 pb-3 space-y-1.5">
                          {server.error && (
                            <p className="text-xs text-red-500 mb-2">{server.error}</p>
                          )}
                          {server.tools.map((tool) => {
                            const isToolBlocked = blockedTools.includes(tool.name);
                            return (
                              <div
                                key={tool.name}
                                className={`flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 pl-2 ${isToolBlocked ? 'opacity-50' : ''}`}
                              >
                                <button
                                  onClick={() => toggleTool(tool.name)}
                                  className={`w-6 h-3.5 rounded-full relative transition-colors duration-150 flex-shrink-0 ${
                                    !isToolBlocked
                                      ? 'bg-accent-500'
                                      : 'bg-zinc-300 dark:bg-zinc-600'
                                  }`}
                                  title={isToolBlocked ? 'Enable tool' : 'Disable tool'}
                                >
                                  <div
                                    className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow-sm transition-transform duration-150 ${
                                      !isToolBlocked ? 'translate-x-3' : 'translate-x-0.5'
                                    }`}
                                  />
                                </button>
                                <span className="font-mono">{tool.name.includes('__') ? tool.name.split('__').slice(1).join('__') : tool.name}</span>
                                {tool.description && (
                                  <span className="text-zinc-400 dark:text-zinc-600 truncate">
                                    — {tool.description}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                          {server.tools.length === 0 && (
                            <p className="text-xs text-zinc-400 pl-2">No tools available</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <p className="text-[11px] text-zinc-400 dark:text-zinc-600 mt-3">
              Edit data/config/mcp-servers.json to add servers
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
