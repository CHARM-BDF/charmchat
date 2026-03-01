import { useState } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useChatStore } from '../../stores/chatStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import type { ProviderName } from '../../types';
import { ChevronDown, GitBranch, Loader2 } from 'lucide-react';
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

  const conversationId = useChatStore((s) => s.conversationId);
  const toolTrace = useChatStore((s) => s.toolTrace);
  const extractWorkflow = useWorkflowStore((s) => s.extractWorkflow);
  const fetchWorkflows = useWorkflowStore((s) => s.fetchWorkflows);

  const [extracting, setExtracting] = useState(false);
  const [extractedName, setExtractedName] = useState<string | null>(null);

  const availableModels = models[provider] || [];

  const handleExtract = async () => {
    if (!conversationId) return;
    setExtracting(true);
    setExtractedName(null);
    try {
      const workflow = await extractWorkflow(conversationId);
      setExtractedName(workflow.name);
      await fetchWorkflows();
      setTimeout(() => setExtractedName(null), 3000);
    } catch (err) {
      console.error('Failed to extract workflow:', err);
    } finally {
      setExtracting(false);
    }
  };

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

        {/* Save as Workflow button */}
        {conversationId && toolTrace.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            {extractedName && (
              <span className="text-xs text-green-600 dark:text-green-400">
                Saved: {extractedName}
              </span>
            )}
            <button
              onClick={handleExtract}
              disabled={extracting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-50 transition-colors duration-150"
              title="Extract a reusable workflow from this conversation's tool calls"
            >
              {extracting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <GitBranch size={14} />
              )}
              <span>Save as Workflow</span>
            </button>
          </div>
        )}
      </div>

      {/* Messages */}
      <MessageList />

      {/* Input */}
      <ChatInput />
    </div>
  );
}
