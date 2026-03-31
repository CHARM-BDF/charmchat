import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Wrench, Check, ChevronRight, ThumbsUp, ThumbsDown, ShieldCheck, ShieldAlert, FileSearch } from 'lucide-react';
import type { Message, ProvenanceReport } from '../../types';
import { useChatStore } from '../../stores/chatStore';
import CodeBlock from '../artifacts/CodeBlock';

interface Props {
  message: Message;
  isStreaming?: boolean;
}

function stripArtifactTags(content: string): string {
  return content.replace(/<artifact[\s\S]*?<\/artifact>/g, '').trim();
}

/**
 * Replace [ev-XXXXXX] taint keys in text with HTML citation badges.
 * Valid keys get a green badge, invalid/unknown keys get red.
 */
function renderCitationBadges(content: string, report?: ProvenanceReport): string {
  if (!report) return content;
  const validKeys = new Set(report.citations.filter(c => c.valid).map(c => c.key));
  return content.replace(/\[ev-([a-f0-9]{6})\]/g, (_match, hex) => {
    const key = `ev-${hex}`;
    const isValid = validKeys.has(key);
    const entry = report.evidenceStore[key];
    const toolLabel = entry ? (entry.toolName.split('__').pop() || entry.toolName) : '?';
    const cls = isValid
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
      : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400';
    return `<span class="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-mono ${cls}" title="${toolLabel}: ${key}">${key}</span>`;
  });
}

function ProvenanceBar({ report }: { report: ProvenanceReport }) {
  const grounded = report.citations.filter(c => c.valid).length;
  const invalid = report.citations.filter(c => !c.valid).length;
  const allValid = report.allCitationsValid;
  const hasToolUse = report.hasEvidence;
  const noCitations = report.citations.length === 0 && hasToolUse;

  return (
    <details className="group text-xs mt-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
      <summary className="px-3 py-1.5 flex items-center gap-2 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <ChevronRight
          size={12}
          className="text-zinc-400 flex-shrink-0 transition-transform group-open:rotate-90"
        />
        {noCitations ? (
          <>
            <ShieldAlert size={12} className="text-amber-500 flex-shrink-0" />
            <span className="text-amber-600 dark:text-amber-400">
              No citations despite tool use
            </span>
          </>
        ) : allValid ? (
          <>
            <ShieldCheck size={12} className="text-emerald-500 flex-shrink-0" />
            <span>
              {grounded} grounded{report.ungroundedSegments > 0 && ` · ${report.ungroundedSegments} ungrounded`}
              {report.uncitedKeys.length > 0 && ` · ${report.uncitedKeys.length} unused evidence`}
            </span>
          </>
        ) : (
          <>
            <ShieldAlert size={12} className="text-red-500 flex-shrink-0" />
            <span className="text-red-600 dark:text-red-400">
              {invalid} invalid citation{invalid !== 1 ? 's' : ''}{grounded > 0 && ` · ${grounded} grounded`}
            </span>
          </>
        )}
      </summary>
      <div className="px-3 pb-2 space-y-1.5">
        {Object.values(report.evidenceStore).filter(e => !e.isEmpty).map(entry => {
          const cited = report.citations.some(c => c.key === entry.key && c.valid);
          return (
            <div key={entry.key} className="flex items-start gap-2">
              <FileSearch size={11} className={`mt-0.5 flex-shrink-0 ${cited ? 'text-emerald-500' : 'text-zinc-400'}`} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[10px] text-zinc-400">[{entry.key}]</span>
                  <span className="font-medium truncate">{entry.toolName.split('__').pop()}</span>
                  {!cited && <span className="text-[10px] text-zinc-400 italic">uncited</span>}
                </div>
                <pre className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 truncate max-w-md">
                  {entry.content.slice(0, 120)}{entry.content.length > 120 ? '...' : ''}
                </pre>
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
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

  const cleanContent = renderCitationBadges(
    stripArtifactTags(message.content),
    message.provenanceReport,
  );

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

        {/* Provenance bar */}
        {!isStreaming && message.provenanceReport && (
          <ProvenanceBar report={message.provenanceReport} />
        )}

        {/* Rating buttons */}
        {!isStreaming && (
          <div className="flex items-center gap-1 mt-1">
            <button
              onClick={() => useChatStore.getState().rateMessage(message.id, 'like')}
              className={`p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors ${
                message.rating === 'like' ? 'text-emerald-500' : 'text-zinc-300 dark:text-zinc-600'
              }`}
              title="Like"
            >
              <ThumbsUp size={14} />
            </button>
            <button
              onClick={() => useChatStore.getState().rateMessage(message.id, 'dislike')}
              className={`p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors ${
                message.rating === 'dislike' ? 'text-red-500' : 'text-zinc-300 dark:text-zinc-600'
              }`}
              title="Dislike"
            >
              <ThumbsDown size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
