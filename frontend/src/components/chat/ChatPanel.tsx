import { useSettingsStore } from '../../stores/settingsStore';
import type { ProviderName } from '../../types';
import { ChevronDown } from 'lucide-react';
import MessageList from './MessageList';
import ChatInput from './ChatInput';

const PROVIDER_LABELS: Record<ProviderName, string> = {
  anthropic: 'Anthropic',
  bedrock: 'Bedrock',
  openai: 'OpenAI',
  gemini: 'Gemini',
  ollama: 'Ollama',
};

const PROVIDERS: ProviderName[] = ['anthropic', 'bedrock', 'openai', 'gemini', 'ollama'];

export default function ChatPanel() {
  const provider = useSettingsStore((s) => s.provider);
  const model = useSettingsStore((s) => s.model);
  const models = useSettingsStore((s) => s.models);
  const setProvider = useSettingsStore((s) => s.setProvider);
  const setModel = useSettingsStore((s) => s.setModel);

  const availableModels = models[provider] || [];

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Top bar with model selector */}
      <div className="h-14 border-b border-zinc-200 dark:border-zinc-800 flex items-center px-4 gap-3">
        <div className="relative">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as ProviderName)}
            className="appearance-none bg-zinc-100 dark:bg-zinc-800 text-sm rounded-lg px-3 py-1.5 pr-7 cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-500 transition-colors duration-150"
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABELS[p]}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400"
          />
        </div>

        <div className="relative">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="appearance-none bg-zinc-100 dark:bg-zinc-800 text-sm rounded-lg px-3 py-1.5 pr-7 cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-500 transition-colors duration-150 max-w-[280px]"
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
            className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400"
          />
        </div>
      </div>

      {/* Messages */}
      <MessageList />

      {/* Input */}
      <ChatInput />
    </div>
  );
}
