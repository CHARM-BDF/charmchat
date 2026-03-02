import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Wrench, Check, ChevronRight } from 'lucide-react';
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
              <details
                key={`${tc.name}-${i}`}
                className="group text-xs bg-zinc-100 dark:bg-zinc-800 rounded-lg"
              >
                <summary className="px-3 py-1.5 flex items-center gap-2 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <ChevronRight
                    size={12}
                    className="text-zinc-400 flex-shrink-0 transition-transform group-open:rotate-90"
                  />
                  <Wrench size={12} className="text-zinc-400 flex-shrink-0" />
                  <span className="truncate font-mono">{tc.name}</span>
                  {tc.result !== undefined && (
                    <Check size={12} className="text-emerald-500 flex-shrink-0" />
                  )}
                </summary>
                <div className="px-3 pb-2 space-y-1.5">
                  {tc.args && Object.keys(tc.args).length > 0 && (
                    <div>
                      <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-0.5">
                        Args
                      </div>
                      <pre className="text-[11px] font-mono bg-zinc-200 dark:bg-zinc-900 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                        {JSON.stringify(tc.args, null, 2)}
                      </pre>
                    </div>
                  )}
                  {tc.result !== undefined && (
                    <div>
                      <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-0.5">
                        Result
                      </div>
                      <pre className="text-[11px] font-mono bg-zinc-200 dark:bg-zinc-900 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
                        {typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </details>
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
              img({ alt }) {
                // Don't render images in chat - they show in the artifact panel
                return <span className="text-xs text-zinc-400 italic">[{alt || 'image'}]</span>;
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
