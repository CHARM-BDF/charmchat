import { useState, useRef, useCallback, useEffect } from 'react';
import { SendHorizontal, Square, KeyRound } from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';
import { useSettingsStore } from '../../stores/settingsStore';
import SettingsModal from '../settings/SettingsModal';

export default function ChatInput() {
  const [value, setValue] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const stopStreaming = useChatStore((s) => s.stopStreaming);

  const provider = useSettingsStore((s) => s.provider);
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const byok = useSettingsStore((s) => s.byok);
  const byokProviders = useSettingsStore((s) => s.byokProviders);

  const needsKey = byok && byokProviders.includes(provider) && !apiKeys[provider];

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming || needsKey) return;
    sendMessage(trimmed);
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, isStreaming, needsKey, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-800 p-4">
      <div className="max-w-3xl mx-auto">
        {needsKey && (
          <div className="mb-2 flex items-center justify-between gap-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 px-4 py-2.5 text-sm">
            <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
              <KeyRound size={14} />
              <span>An API key is required. It will be stored only in your browser.</span>
            </div>
            <button
              onClick={() => setSettingsOpen(true)}
              className="text-xs font-medium text-amber-700 dark:text-amber-300 hover:underline whitespace-nowrap"
            >
              Open Settings
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={needsKey ? 'Add your API key to start chatting…' : 'Send a message...'}
            rows={1}
            disabled={needsKey}
            className="w-full resize-none bg-zinc-100 dark:bg-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500 transition-colors duration-150 leading-relaxed disabled:opacity-50 disabled:cursor-not-allowed"
          />
          {isStreaming ? (
            <button
              onClick={stopStreaming}
              className="flex-shrink-0 p-2.5 rounded-xl bg-red-500 text-white hover:bg-red-600 transition-colors duration-150"
              title="Stop generating"
            >
              <Square size={18} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!value.trim() || needsKey}
              className="flex-shrink-0 p-2.5 rounded-xl bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
              title="Send message"
            >
              <SendHorizontal size={18} />
            </button>
          )}
        </div>
      </div>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
