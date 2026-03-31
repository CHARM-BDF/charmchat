import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Wrench, Check, ChevronRight, ThumbsUp, ThumbsDown, ShieldCheck, ShieldAlert, AlertTriangle, Quote } from 'lucide-react';
import type { Message, ProvenanceReport, ClaimEvidence } from '../../types';
import { useChatStore } from '../../stores/chatStore';
import CodeBlock from '../artifacts/CodeBlock';

interface Props {
  message: Message;
  isStreaming?: boolean;
}

function stripArtifactTags(content: string): string {
  return content.replace(/<artifact[\s\S]*?<\/artifact>/g, '').trim();
}

function toolLabel(name: string): string {
  return name.split('__').pop() || name;
}

function ClaimRow({ claim, report }: { claim: ClaimEvidence; report: ProvenanceReport }) {
  const verified = claim.keyValid && claim.excerptVerified;
  const keyOnly = claim.keyValid && !claim.excerptVerified;
  const entry = report.evidenceStore[claim.evidenceKey];
  const source = entry ? toolLabel(entry.toolName) : claim.evidenceKey;

  return (
    <div className="border-l-2 pl-2.5 py-1 border-zinc-200 dark:border-zinc-700">
      <div className="flex items-start gap-1.5">
        {verified ? (
          <Check size={11} className="mt-0.5 flex-shrink-0 text-emerald-500" />
        ) : keyOnly ? (
          <AlertTriangle size={11} className="mt-0.5 flex-shrink-0 text-amber-500" />
        ) : (
          <ShieldAlert size={11} className="mt-0.5 flex-shrink-0 text-red-500" />
        )}
        <span className="text-zinc-700 dark:text-zinc-300">{claim.claim}</span>
      </div>
      <div className="mt-1 ml-4">
        <div className="text-[10px] text-zinc-400 mb-0.5">
          via <span className="font-medium text-zinc-500 dark:text-zinc-300">{source}</span>
        </div>
        <div className="flex items-start gap-1.5 text-[10px] text-zinc-400">
          <Quote size={9} className="mt-0.5 flex-shrink-0" />
          <span className="italic line-clamp-2">{claim.excerpt}</span>
        </div>
        {claim.sourceIds && claim.sourceIds.length > 0 && (
          <div className="flex items-center gap-1 mt-0.5 text-[10px] flex-wrap">
            {claim.sourceIds.map((id, i) => (
              <span key={i} className="text-accent-600 dark:text-accent-400 font-mono">{id}</span>
            ))}
          </div>
        )}
        {!verified && (
          <div className="text-[10px] mt-0.5">
            {!claim.keyValid ? (
              <span className="text-red-500">invalid evidence key</span>
            ) : (
              <span className="text-amber-500">excerpt not found in source</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ProvenancePanel({ report }: { report: ProvenanceReport }) {
  const verified = report.claims.filter(c => c.keyValid && c.excerptVerified).length;
  const unverified = report.claims.length - verified;
  const noClaims = report.claims.length === 0 && report.hasEvidence;

  return (
    <details className="group text-xs mt-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
      <summary className="px-3 py-1.5 flex items-center gap-2 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <ChevronRight
          size={12}
          className="text-zinc-400 flex-shrink-0 transition-transform group-open:rotate-90"
        />
        {noClaims ? (
          <>
            <ShieldAlert size={12} className="text-amber-500 flex-shrink-0" />
            <span className="text-amber-600 dark:text-amber-400">
              No provenance claims despite tool use
            </span>
          </>
        ) : (
          <>
            <ShieldCheck size={12} className={`flex-shrink-0 ${unverified > 0 ? 'text-amber-500' : 'text-emerald-500'}`} />
            <span>
              {verified} verified claim{verified !== 1 ? 's' : ''}
              {unverified > 0 && <span className="text-amber-600 dark:text-amber-400"> · {unverified} unverified</span>}
              {report.uncitedKeys.length > 0 && ` · ${report.uncitedKeys.length} unused source${report.uncitedKeys.length !== 1 ? 's' : ''}`}
            </span>
          </>
        )}
      </summary>
      <div className="px-3 pb-2 space-y-2">
        {report.claims.map((claim, i) => (
          <ClaimRow key={i} claim={claim} report={report} />
        ))}
        {report.uncitedKeys.length > 0 && (
          <div className="mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-700">
            <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-1">
              Unused sources
            </div>
            {report.uncitedKeys.map(key => {
              const entry = report.evidenceStore[key];
              return (
                <div key={key} className="flex items-center gap-1.5 text-[10px] text-zinc-400 py-0.5">
                  <Wrench size={9} className="flex-shrink-0" />
                  <span className="font-medium">{entry ? toolLabel(entry.toolName) : key}</span>
                  {entry && (
                    <span className="truncate max-w-xs">{entry.content.slice(0, 80)}{entry.content.length > 80 ? '...' : ''}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
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

        {/* Provenance panel */}
        {!isStreaming && message.provenanceReport && (
          <ProvenancePanel report={message.provenanceReport} />
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
