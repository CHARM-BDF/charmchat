import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Wrench, Check } from 'lucide-react';
import type { Message } from '../../types';
import CodeBlock from '../artifacts/CodeBlock';

interface Props {
  message: Message;
  isStreaming?: boolean;
}

function stripArtifactTags(content: string): string {
  return content.replace(/<artifact[\s\S]*?<\/artifact>/g, '').trim();
}

export default function MessageBubble({ message, isStreaming }: Props) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[80%] bg-accent-500 text-white rounded-2xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed">
          {message.content}
        </div>
      </div>
    );
  }

  const cleanContent = stripArtifactTags(message.content);

  return (
    <div className="flex justify-start mb-4">
      <div className="max-w-[80%]">
        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mb-2 space-y-1">
            {message.toolCalls.map((tc, i) => (
              <div
                key={`${tc.name}-${i}`}
                className="text-xs bg-zinc-100 dark:bg-zinc-800 rounded-lg px-3 py-1.5 flex items-center gap-2"
              >
                <Wrench size={12} className="text-zinc-400 flex-shrink-0" />
                <span className="truncate font-mono">{tc.name}</span>
                {tc.result !== undefined && (
                  <Check size={12} className="text-emerald-500 flex-shrink-0" />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Content */}
        <div className="prose prose-zinc dark:prose-invert prose-sm max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const codeString = String(children).replace(/\n$/, '');

                if (match) {
                  return <CodeBlock content={codeString} language={match[1]} />;
                }

                return (
                  <code
                    className="bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-[13px] font-mono"
                    {...props}
                  >
                    {children}
                  </code>
                );
              },
              pre({ children }) {
                return <>{children}</>;
              },
            }}
          >
            {cleanContent}
          </ReactMarkdown>
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-accent-500 rounded-sm animate-pulse ml-0.5 align-text-bottom" />
          )}
        </div>
      </div>
    </div>
  );
}
