import { useState, useRef, useCallback, useEffect } from 'react';
import { SendHorizontal, Square, KeyRound, Swords, ChevronDown } from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';
import { useSettingsStore } from '../../stores/settingsStore';
import SettingsModal from '../settings/SettingsModal';

type ChatMode = 'normal' | 'message' | 'transcript';

const MODE_LABELS: Record<ChatMode, string> = {
  normal: 'Chat',
  message: '⚔ Challenge this message',
  transcript: '⚔ Challenge last reply',
};

const MODE_PLACEHOLDERS: Record<ChatMode, string> = {
  normal: 'Send a message...',
  message: 'Type a claim or report — Picrophant will hunt for evidence against it…',
  transcript: 'Optional focus, then send to challenge the last reply…',
};

export default function ChatInput() {
  const [value, setValue] = useState('');
  const [mode, setMode] = useState<ChatMode>('normal');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const sendChallenge = useChatStore((s) => s.sendChallenge);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const hasAssistant = useChatStore((s) => s.messages.some((m) => m.role === 'assistant'));

  const provider = useSettingsStore((s) => s.provider);
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const byok = useSettingsStore((s) => s.byok);
  const byokProviders = useSettingsStore((s) => s.byokProviders);

  const needsKey = byok && byokProviders.includes(provider) && !apiKeys[provider];

  // "Challenge last reply" needs an assistant reply to target; fall back to normal
  // chat if the user picked it before there's anything to challenge.
  const effectiveMode: ChatMode = mode === 'transcript' && !hasAssistant ? 'normal' : mode;
  const isChallenge = effectiveMode !== 'normal';

  // Transcript challenge can run with no typed text (it targets the last reply);
  // the other modes need content.
  const canSend = !needsKey && (effectiveMode === 'transcript' || value.trim().length > 0);

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
    if (isStreaming || needsKey) return;
    const trimmed = value.trim();
    if (effectiveMode === 'normal') {
      if (!trimmed) return;
      sendMessage(trimmed);
    } else if (effectiveMode === 'message') {
      if (!trimmed) return;
      sendChallenge(trimmed, 'message');
    } else {
      sendChallenge(trimmed, 'transcript');
    }
    setValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, isStreaming, needsKey, effectiveMode, sendMessage, sendChallenge]);

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

        {/* Mode picker — Chat vs. Picrophant challenge modes */}
        <div className="mb-2 flex items-center gap-2">
          <div className="relative">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as ChatMode)}
              className={`appearance-none rounded-lg pl-3 pr-7 py-1.5 text-xs cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-500 transition-colors duration-150 ${
                isChallenge
                  ? 'bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-300'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'
              }`}
              title="Chat normally, or have Picrophant challenge what you send"
            >
              <option value="normal">{MODE_LABELS.normal}</option>
              <option value="message">{MODE_LABELS.message}</option>
              <option value="transcript" disabled={!hasAssistant}>
                {MODE_LABELS.transcript}
              </option>
            </select>
            <ChevronDown
              size={13}
              className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400"
            />
          </div>
          {isChallenge && (
            <span className="flex items-center gap-1 text-[11px] text-rose-500">
              <Swords size={12} /> Searches for refuting evidence — verdicts are grounded in verified excerpts
            </span>
          )}
        </div>

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={needsKey ? 'Add your API key to start chatting…' : MODE_PLACEHOLDERS[effectiveMode]}
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
              disabled={!canSend}
              className={`flex-shrink-0 p-2.5 rounded-xl text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150 ${
                isChallenge ? 'bg-rose-500 hover:bg-rose-600' : 'bg-accent-500 hover:bg-accent-600'
              }`}
              title={isChallenge ? 'Challenge' : 'Send message'}
            >
              {isChallenge ? <Swords size={18} /> : <SendHorizontal size={18} />}
            </button>
          )}
        </div>
      </div>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
