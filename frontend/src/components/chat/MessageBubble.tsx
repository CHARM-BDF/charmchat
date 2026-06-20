import { useState, lazy, Suspense } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Wrench, Check, ChevronRight, ThumbsUp, ThumbsDown, ShieldCheck, ShieldAlert, AlertTriangle, Quote, Swords, Loader2, XCircle, Search, CornerDownRight } from 'lucide-react';
import type { Message, ProvenanceReport, ClaimEvidence, CounterReport, CounterClaim, CounterEdge, ClaimVerdict, ToolCallDisplay } from '../../types';
import { useChatStore } from '../../stores/chatStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { post } from '../../lib/api';
import { parseSSE } from '../../lib/sse';
import { renderCitationLinks } from '../../lib/citations';
import CodeBlock from '../artifacts/CodeBlock';

// reagraph is heavy; lazy-load it so the argument-map view only pulls it in on demand.
const CounterGraph = lazy(() => import('./CounterGraph'));

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

function ToolCallList({ toolCalls }: { toolCalls: ToolCallDisplay[] }) {
  return (
    <div className="space-y-1">
      {toolCalls.map((tc, i) => (
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
  );
}

function ClaimRow({ claim, report, index }: { claim: ClaimEvidence; report: ProvenanceReport; index: number }) {
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
        <span className="text-zinc-700 dark:text-zinc-300">
          <span className={`text-[9px] font-semibold mr-1 ${verified ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>[{index + 1}]</span>
          {claim.claim}
        </span>
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
          <ClaimRow key={i} claim={claim} report={report} index={i} />
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

const VERDICT_META: Record<ClaimVerdict, { label: string; cls: string; Icon: typeof Check }> = {
  contradicted: { label: 'Contradicted', cls: 'text-red-500', Icon: XCircle },
  weakened: { label: 'Weakened', cls: 'text-amber-500', Icon: AlertTriangle },
  stands: { label: 'Stands', cls: 'text-emerald-500', Icon: Check },
};

// An inferential edge out of a claim: the move to a downstream claim, with whether
// the evidence licenses it. This is where "weakened"-style weaknesses live.
function EdgeRow({ edge, report }: { edge: CounterEdge; report: CounterReport }) {
  const store = report.provenance.evidenceStore;
  const target = report.counterClaims[edge.to];
  const targetLabel = target ? target.claim : `claim ${edge.to + 1}`;
  const evidence = report.provenance.claims.filter(c => edge.evidenceKeys.includes(c.evidenceKey));

  return (
    <div className="mt-1 ml-1 pl-2 border-l border-dashed border-zinc-300 dark:border-zinc-600">
      <div className="flex items-start gap-1 text-[10px] flex-wrap">
        <CornerDownRight size={10} className="mt-0.5 flex-shrink-0 text-zinc-400" />
        <span className="text-zinc-500 dark:text-zinc-400">
          infers <span className="font-semibold text-zinc-400">[{edge.to + 1}]</span> {targetLabel}
        </span>
        {edge.move && (
          <span className="px-1.5 py-px rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-300 font-mono">
            {edge.move}
          </span>
        )}
        <span className={`font-semibold ${edge.licensed ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
          {edge.licensed ? '✓ licensed' : '⚠ unwarranted'}
        </span>
      </div>
      {edge.rationale && (
        <div className="ml-4 text-[10px] text-zinc-500 dark:text-zinc-400">{edge.rationale}</div>
      )}
      {evidence.map((ev, i) => {
        const source = store[ev.evidenceKey] ? toolLabel(store[ev.evidenceKey].toolName) : ev.evidenceKey;
        return (
          <div key={i} className="ml-4 mt-0.5">
            <div className="flex items-start gap-1.5 text-[10px] text-zinc-400">
              {ev.excerptVerified ? (
                <Check size={9} className="mt-0.5 flex-shrink-0 text-emerald-500" />
              ) : (
                <AlertTriangle size={9} className="mt-0.5 flex-shrink-0 text-amber-500" />
              )}
              <span className="italic line-clamp-2">{ev.excerpt}</span>
            </div>
            <div className="ml-4 flex items-center gap-1 text-[10px] flex-wrap">
              <span className="text-zinc-400">via {source}</span>
              {ev.sourceIds?.map((id, j) => (
                <span key={j} className="text-accent-600 dark:text-accent-400 font-mono">{id}</span>
              ))}
              {!ev.excerptVerified && <span className="text-amber-500">excerpt unverified</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CounterClaimRow({ cc, report, index }: { cc: CounterClaim; report: CounterReport; index: number }) {
  const meta = VERDICT_META[cc.verdict];
  const Icon = meta.Icon;
  const store = report.provenance.evidenceStore;
  const evidence = report.provenance.claims.filter(c => cc.evidenceKeys.includes(c.evidenceKey));
  const outgoing = (report.edges ?? []).filter(e => e.from === index);

  return (
    <div className="border-l-2 pl-2.5 py-1 border-zinc-200 dark:border-zinc-700">
      <div className="flex items-start gap-1.5">
        <Icon size={11} className={`mt-0.5 flex-shrink-0 ${meta.cls}`} />
        <span className="text-zinc-700 dark:text-zinc-300">
          <span className="text-[9px] font-semibold mr-1 text-zinc-400">[{index + 1}]</span>
          {cc.claim}
        </span>
      </div>
      <div className="mt-1 ml-4">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className={`text-[10px] font-semibold uppercase tracking-wide ${meta.cls}`}>{meta.label}</span>
          {cc.unverifiable && (
            <span className="flex items-center gap-0.5 text-[10px] text-zinc-400">
              <Search size={9} /> unverifiable
            </span>
          )}
        </div>
        {cc.rationale && (
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-1">{cc.rationale}</div>
        )}
        {evidence.map((ev, i) => {
          const source = store[ev.evidenceKey] ? toolLabel(store[ev.evidenceKey].toolName) : ev.evidenceKey;
          return (
            <div key={i} className="mt-0.5">
              <div className="flex items-start gap-1.5 text-[10px] text-zinc-400">
                {ev.excerptVerified ? (
                  <Check size={9} className="mt-0.5 flex-shrink-0 text-emerald-500" />
                ) : (
                  <AlertTriangle size={9} className="mt-0.5 flex-shrink-0 text-amber-500" />
                )}
                <span className="italic line-clamp-2">{ev.excerpt}</span>
              </div>
              <div className="ml-4 flex items-center gap-1 text-[10px] flex-wrap">
                <span className="text-zinc-400">via {source}</span>
                {ev.sourceIds?.map((id, j) => (
                  <span key={j} className="text-accent-600 dark:text-accent-400 font-mono">{id}</span>
                ))}
                {!ev.excerptVerified && <span className="text-amber-500">excerpt unverified</span>}
              </div>
            </div>
          );
        })}
        {outgoing.map((e, i) => (
          <EdgeRow key={`edge-${i}`} edge={e} report={report} />
        ))}
      </div>
    </div>
  );
}

function CounterReportPanel({ report }: { report: CounterReport }) {
  const counts = { contradicted: 0, weakened: 0, stands: 0, unverifiable: 0 };
  for (const c of report.counterClaims) {
    counts[c.verdict]++;
    if (c.unverifiable) counts.unverifiable++;
  }
  const unwarranted = (report.edges ?? []).filter(e => !e.licensed).length;
  const verifiedExcerpts = report.provenance.claims.filter(c => c.excerptVerified).length;
  const hasEdges = (report.edges?.length ?? 0) > 0;
  const [view, setView] = useState<'list' | 'map'>(hasEdges ? 'map' : 'list');

  return (
    <details className="group text-xs mt-1.5 rounded-lg bg-rose-50/60 dark:bg-rose-950/20" open>
      <summary className="px-3 py-1.5 flex items-center gap-2 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <ChevronRight size={12} className="text-zinc-400 flex-shrink-0 transition-transform group-open:rotate-90" />
        <Swords size={12} className="text-rose-500 flex-shrink-0" />
        <span>
          Counter-report · {report.counterClaims.length} challenged
          {counts.contradicted > 0 && <span className="text-red-500"> · {counts.contradicted} contradicted</span>}
          {counts.weakened > 0 && <span className="text-amber-600 dark:text-amber-400"> · {counts.weakened} weakened</span>}
          {counts.stands > 0 && <span className="text-emerald-600 dark:text-emerald-400"> · {counts.stands} stand</span>}
          {counts.unverifiable > 0 && <span className="text-zinc-400"> · {counts.unverifiable} unverifiable</span>}
          {unwarranted > 0 && <span className="text-amber-600 dark:text-amber-400"> · {unwarranted} unwarranted inference{unwarranted !== 1 ? 's' : ''}</span>}
        </span>
      </summary>
      <div className="px-3 pb-2 space-y-2">
        {hasEdges && (
          <div className="flex gap-1 text-[10px]">
            <button
              onClick={() => setView('map')}
              className={`px-2 py-0.5 rounded ${view === 'map' ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'}`}
            >
              Map
            </button>
            <button
              onClick={() => setView('list')}
              className={`px-2 py-0.5 rounded ${view === 'list' ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'}`}
            >
              List
            </button>
          </div>
        )}
        {view === 'map' && hasEdges ? (
          <Suspense fallback={<div className="text-[11px] text-zinc-400 py-12 text-center">Loading map…</div>}>
            <CounterGraph report={report} />
          </Suspense>
        ) : (
          report.counterClaims.map((cc, i) => (
            <CounterClaimRow key={i} cc={cc} report={report} index={i} />
          ))
        )}
        <div className="text-[10px] text-zinc-400 pt-1 border-t border-zinc-200/60 dark:border-zinc-700/60">
          {verifiedExcerpts} of {report.provenance.claims.length} anti-evidence excerpt(s) verified against source
        </div>
      </div>
    </details>
  );
}

export default function MessageBubble({ message, isStreaming }: Props) {
  const [challenge, setChallenge] = useState<{
    phase: 'idle' | 'running' | 'done' | 'error';
    status: string;
    toolCalls: ToolCallDisplay[];
    report: CounterReport | null;
    error: string;
  }>({ phase: 'idle', status: '', toolCalls: [], report: null, error: '' });

  async function runChallenge() {
    const pr = message.provenanceReport;
    if (!pr) return;
    const claims = pr.claims.map(c => c.claim);
    const reportText = stripArtifactTags(message.content);
    const { provider, model, apiKeys, byok, byokProviders } = useSettingsStore.getState();
    const includeKey = byok && byokProviders.includes(provider);
    const apiKey = includeKey ? apiKeys[provider]?.trim() : undefined;

    setChallenge({ phase: 'running', status: 'Starting…', toolCalls: [], report: null, error: '' });
    try {
      const response = (await post(
        '/picrophant/challenge',
        { report: reportText, claims, provider, model, ...(apiKey ? { apiKey } : {}) },
        { raw: true }
      )) as unknown as Response;

      const tcList: ToolCallDisplay[] = [];
      let finalReport: CounterReport | null = null;
      for await (const event of parseSSE(response)) {
        const data = event.data as Record<string, unknown>;
        switch (event.event) {
          case 'status':
            setChallenge(s => ({ ...s, status: String(data.message || '') }));
            break;
          case 'claims':
            setChallenge(s => ({ ...s, status: 'Challenging claims…' }));
            break;
          case 'tool_call': {
            const tc = data as { name: string; args?: Record<string, unknown> };
            tcList.push({ name: tc.name, args: tc.args || {} });
            setChallenge(s => ({ ...s, toolCalls: [...tcList] }));
            break;
          }
          case 'tool_result': {
            const tr = data as { name: string; result: unknown };
            const existing = tcList.find(t => t.name === tr.name && t.result === undefined);
            if (existing) {
              existing.result = tr.result;
              setChallenge(s => ({ ...s, toolCalls: [...tcList] }));
            }
            break;
          }
          case 'done':
            finalReport = data.counterReport as CounterReport;
            setChallenge(s => ({ ...s, phase: 'done', report: finalReport }));
            // Persist onto the message so it survives navigation / reload.
            void useChatStore.getState().saveChallengeResult(message.id, finalReport, [...tcList]);
            break;
          case 'error':
            setChallenge(s => ({ ...s, phase: 'error', error: String(data.error || 'Failed') }));
            break;
        }
      }
      // Finalize if the stream ended without a terminal event.
      setChallenge(s =>
        s.phase === 'running'
          ? { ...s, phase: finalReport ? 'done' : 'error', error: finalReport ? '' : 'No counter-report produced.' }
          : s
      );
    } catch (err) {
      setChallenge(s => ({ ...s, phase: 'error', error: (err as Error).message }));
    }
  }

  if (message.role === 'user') {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[80%] bg-accent-500 text-white rounded-2xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed">
          {message.content}
        </div>
      </div>
    );
  }

  let cleanContent = stripArtifactTags(message.content);
  if (message.provenanceReport) {
    cleanContent = renderCitationLinks(cleanContent, message.provenanceReport);
  }

  return (
    <div className="flex justify-start mb-4">
      <div className="max-w-[80%]">
        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mb-2">
            <ToolCallList toolCalls={message.toolCalls} />
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

        {/* Persisted counter-report — from the per-message button OR a challenge-mode
            reply. Survives navigation / reload. */}
        {!isStreaming && message.counterReport && (
          <div className="mt-1.5 space-y-1">
            {message.challengeToolCalls && message.challengeToolCalls.length > 0 && (
              <ToolCallList toolCalls={message.challengeToolCalls} />
            )}
            <CounterReportPanel report={message.counterReport} />
          </div>
        )}

        {/* Picrophant — per-message "Challenge claims" button (only until a report exists) */}
        {!isStreaming &&
          !message.counterReport &&
          message.provenanceReport &&
          message.provenanceReport.claims.length > 0 && (
            <div className="mt-1.5 space-y-1">
              {challenge.phase === 'idle' && (
                <button
                  onClick={runChallenge}
                  className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                  title="Search for evidence against these claims"
                >
                  <Swords size={13} /> Challenge claims
                </button>
              )}
              {challenge.toolCalls.length > 0 && challenge.phase === 'running' && (
                <ToolCallList toolCalls={challenge.toolCalls} />
              )}
              {challenge.phase === 'running' && (
                <div className="flex items-center gap-2 text-[11px] text-zinc-500 px-2 py-1">
                  <Loader2 size={13} className="animate-spin text-rose-500 flex-shrink-0" />
                  <span>
                    {challenge.status}
                    {challenge.toolCalls.length > 0 ? ` · ${challenge.toolCalls.length} ${challenge.toolCalls.length === 1 ? 'query' : 'queries'}` : ''}
                  </span>
                </div>
              )}
              {challenge.phase === 'error' && (
                <div className="text-[11px] text-red-500 px-2 py-1">Challenge failed: {challenge.error}</div>
              )}
            </div>
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
