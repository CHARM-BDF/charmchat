import { useCallback, useEffect, useRef } from 'react';
import { useChatStore } from '../../stores/chatStore';
import MessageBubble from './MessageBubble';
import { MessageSquare } from 'lucide-react';

export default function MessageList() {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const streamingContent = useChatStore((s) => s.streamingContent);
  const pendingToolCalls = useChatStore((s) => s.pendingToolCalls);
  const error = useChatStore((s) => s.error);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    // Consider "near bottom" if within 100px of the bottom
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScroll.current = distanceFromBottom < 100;
  }, []);

  useEffect(() => {
    if (shouldAutoScroll.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingContent]);

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-zinc-400 dark:text-zinc-600">
          <MessageSquare size={40} className="mx-auto mb-3 opacity-50" />
          <p className="text-lg font-medium">Start a conversation</p>
          <p className="text-sm mt-1">Send a message to begin</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-6">
      <div className="max-w-3xl mx-auto">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isStreaming && (
          <MessageBubble
            message={{
              id: 'streaming',
              role: 'assistant',
              content: streamingContent,
              toolCalls: pendingToolCalls.length > 0 ? pendingToolCalls : undefined,
              timestamp: new Date().toISOString(),
            }}
            isStreaming
          />
        )}

        {error && (
          <div className="mb-4 mx-auto max-w-[80%] bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
