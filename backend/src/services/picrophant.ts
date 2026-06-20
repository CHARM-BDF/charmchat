import type {
  ChatMessage,
  ProviderName,
  ToolCall,
  ClaimVerdict,
  CounterClaim,
  CounterEdge,
  CounterReport,
  ClaimEvidence,
} from '../types/index.js';
import { LLMService } from './llm/index.js';
import { MCPService } from './mcp.js';
import { TaintKeyProvenanceTracker, TAINT_KEY_SYSTEM_PROMPT } from './provenance.js';

const PICROPHANT_MAX_ITERATIONS = 10;
const MAX_CLAIMS = 12;
const VALID_VERDICTS: ClaimVerdict[] = ['contradicted', 'weakened', 'stands'];

const CLAIM_EXTRACT_PROMPT = `Extract the distinct, load-bearing claims from the report below — the mechanistic and therapeutic assertions whose truth the report's conclusions depend on. Prefer inferential claims ("X causes Y", "drug Z improves condition W") over background facts. Capture BOTH ends of the argument: the upstream evidence-level claims AND the downstream therapeutic/recommendation claims they support, so the inferential chain has both its premises and its conclusions. Return ONLY a JSON array of strings, at most ${MAX_CLAIMS}, most load-bearing first. No prose.

REPORT:
`;

const PICROPHANT_SYSTEM_PROMPT = `You are Picrophant, an adversarial scientific reviewer — the structural opposite of a sycophant. Your ADVERSARIAL energy goes into the SEARCH, not the scoring: for each claim, aggressively query the available tools (literature, knowledge graphs, databases) for evidence that would refute or undercut it. But the VERDICT you then assign is a NEUTRAL fact-check — you grade the claim on what the evidence shows, not on how hard you hunted.

For each claim:
- Formulate disconfirming queries: contradicting findings, failed replications, alternative explanations, model/population mismatches (e.g. mouse-only evidence extrapolated to humans), small-sample or single-case generalizations, and confounds.
- Ground every factual statement in tool results. Do NOT rely on your own background knowledge for factual claims.

Then assign each claim exactly one verdict, judged ONLY on whether the claim — taken in isolation, as stated — is true. NOT on how it is used downstream, and NOT on how hard you searched:
- "stands": the claim is true/supported as stated. This is the DEFAULT and the EXPECTED outcome for most well-cited factual claims — you searched for refutation and found nothing that overturns the claim itself, so it stands. Reporting "stands" after a genuine search is the honest result, NOT a failure. A claim still stands even if its evidence is preclinical/mouse-based, or if it is later used in an unwarranted inference — those are edge-level concerns, handled separately.
- "weakened": you found SPECIFIC evidence that the claim's OWN content overreaches — e.g. a direct study contradicting the claimed effect size, or the claim asserting materially more than its own cited evidence supports. NOT merely "the evidence is preclinical" and NOT "it feeds a shaky downstream step".
- "contradicted": you found evidence that the claim, as stated, is false — e.g. the claimed mechanism is directly refuted by a functional study.
Separately, set "unverifiable": true if you could not ground or check the claim at all. This is ORTHOGONAL to the verdict — never label an unchecked claim "stands".

CALIBRATION: in a typical literature report most claims STAND on their own — the citations are usually real; the report's weakness lives in the inferences BETWEEN claims, which are assessed separately (not here). If you find yourself marking nearly every claim "weakened", you are conflating the claims with the argument — stop and re-grade each claim on its own truth. You are NOT rewarded for manufacturing dissent; a wall of "weakened" is as useless as a wall of "stands".

When finished querying, output, in this order:
1. A brief markdown analysis — one short paragraph per claim — with [ev-XXXXXX] evidence keys inline.
2. A <verdicts> block: a JSON array, one object per claim, in the SAME ORDER the claims were given:
<verdicts>
[
  {"claim": "<the claim text>", "verdict": "weakened", "unverifiable": false, "rationale": "<why, naming the kind of weakness>", "evidenceKeys": ["ev-a1b2c3"]}
]
</verdicts>
"evidenceKeys" are the [ev-XXXXXX] keys of the anti-evidence behind your verdict (empty array if the claim stands or is unverifiable with no evidence).`;

// Pass 2 (structure-only): run AFTER pass 1 has produced grounded, excerpt-verified
// verdicts, with tools disabled, so drawing the argument graph never competes with the
// verbatim excerpting that earns picrophant's trust. The provenance is already locked.
function buildEdgesPrompt(claims: string[]): string {
  const claimList = claims.map((c, i) => `${i + 1}. ${c}`).join('\n');
  return `Now map the INFERENTIAL STRUCTURE of the report's argument over the claims you just assessed. Do NOT call any tools and do NOT restate the verdicts.

Claims:
${claimList}

A literature report is a chain: one claim's evidence is used to infer another (mouse→human, homozygous→heterozygous, serum→central biomarker, n=1→recommendation, mechanism→clinical benefit, …). A report's weak joints are usually these MOVES, even when both claims they connect are individually true.

Output ONLY an <edges> block — a JSON array of the inferential dependencies between the claims above:
- "from"/"to": the claim NUMBERS above.
- "move": the type of inferential leap.
- "licensed": whether the evidence already gathered warrants the move — true for sound moves, false for unwarranted joints. Include BOTH; a map of which inferences hold is as valuable as which fail.
- "evidenceKeys": for unlicensed moves, the [ev-XXXXXX] keys (from the tool results above) of anti-evidence that the move fails.
<edges>
[
  {"from": 1, "to": 7, "move": "established mechanism→therapeutic rationale", "licensed": true, "rationale": "<why this move holds>", "evidenceKeys": []},
  {"from": 3, "to": 7, "move": "serum→central biomarker", "licensed": false, "rationale": "<why the move isn't warranted>", "evidenceKeys": ["ev-a1b2c3"]}
]
</edges>
Output nothing but the <edges> block.`;
}

// Forced wrap-up when the sub-agent has used its tool-query budget (or otherwise
// stopped) without emitting a <verdicts> block. It must now decide from the evidence
// already gathered rather than query further.
const SYNTHESIS_PROMPT = `Stop querying — do NOT call any more tools. Using ONLY the evidence already gathered above, produce your final output now, in this exact order:
1. A brief markdown analysis, one short paragraph per claim, with the relevant [ev-XXXXXX] evidence keys inline.
2. The <verdicts> block: a JSON array, one object per claim, in the SAME ORDER the claims were given.
3. The <provenance> block citing every [ev-XXXXXX] key you reference, with VERBATIM excerpts.
Grade each claim on its OWN truth in isolation, not on how hard you searched: a true claim "stands" — the EXPECTED outcome for most well-cited facts — even if its evidence is preclinical or a downstream inference misuses it. Reserve "weakened" for a claim whose own content overreaches its cited evidence, and "contradicted" for a claim that is itself false. If you're marking nearly every claim "weakened", you're conflating the claims with the argument — re-grade. Set "unverifiable": true only if you could not check it. Do not omit any claim.`;

interface McpToolResult {
  content?: { type: string; text?: string; data?: string; mimeType?: string }[];
}

interface ChallengeOptions {
  provider: ProviderName;
  model?: string;
  apiKey?: string;
}

interface ToolCallResult {
  content: { type: string; text: string }[];
  artifacts: { type: string; title: string; content: string }[];
}

export interface PicrophantEvent {
  event: 'status' | 'claims' | 'tool_call' | 'tool_result' | 'done' | 'error';
  data: Record<string, unknown>;
}

export class PicrophantService {
  private llmService: LLMService;
  private mcpService: MCPService;

  constructor(llmService: LLMService, mcpService: MCPService) {
    this.llmService = llmService;
    this.mcpService = mcpService;
  }

  /**
   * Non-streaming convenience wrapper used by the dev harness (run-picrophant.ts).
   * Drains the stream and returns the final counter-report as a tool-result shape.
   */
  async challengeReport(args: Record<string, unknown>, opts: ChallengeOptions): Promise<ToolCallResult> {
    let markdown = '';
    for await (const ev of this.challengeStream(args, opts)) {
      if (ev.event === 'done') markdown = String((ev.data as { markdown?: string }).markdown ?? '');
      else if (ev.event === 'error') return errorResult(String((ev.data as { error?: string }).error ?? 'Picrophant failed.'));
    }
    if (!markdown) return errorResult('Picrophant: no counter-report produced.');
    return {
      content: [{ type: 'text', text: markdown }],
      artifacts: [{ type: 'markdown', title: 'Picrophant Counter-Report', content: markdown }],
    };
  }

  /**
   * Prosecutorial pass over a report, streamed. Extracts claims (unless provided),
   * runs the disconfirming sub-agent loop with its own provenance tracker, and
   * yields progress so the UI isn't a silent spinner. The sub-agent's toolset comes
   * from MCPService.getTools(), which never includes picrophant — recursion guard free.
   */
  async *challengeStream(args: Record<string, unknown>, opts: ChallengeOptions): AsyncGenerator<PicrophantEvent> {
    const report = typeof args.report === 'string' ? args.report : '';
    if (!report.trim()) {
      yield { event: 'error', data: { error: 'No report text provided to challenge.' } };
      return;
    }
    const focus = typeof args.focus === 'string' && args.focus.trim() ? args.focus.trim() : undefined;

    let claims = Array.isArray(args.claims)
      ? (args.claims as unknown[]).filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
      : [];

    if (claims.length === 0) {
      yield { event: 'status', data: { phase: 'extracting', message: 'Extracting claims from the report…' } };
      claims = await this.extractClaims(report, opts);
    }
    claims = claims.slice(0, MAX_CLAIMS);

    if (claims.length === 0) {
      yield { event: 'error', data: { error: 'Could not identify any claims to challenge in the report.' } };
      return;
    }
    yield { event: 'claims', data: { claims } };

    const provider = this.llmService.createProvider(opts.provider, opts.apiKey);
    const tools = this.mcpService.getTools();
    const tracker = new TaintKeyProvenanceTracker();

    const messages: ChatMessage[] = [
      { role: 'system', content: PICROPHANT_SYSTEM_PROMPT + TAINT_KEY_SYSTEM_PROMPT },
      { role: 'user', content: buildChallengePrompt(report, claims, focus) },
    ];

    let iteration = 0;
    let finalText = '';
    let aborted = false;

    while (iteration < PICROPHANT_MAX_ITERATIONS && !aborted) {
      iteration++;
      yield { event: 'status', data: { phase: 'querying', message: `Querying evidence (round ${iteration})…` } };

      let fullText = '';
      const pending: ToolCall[] = [];
      for await (const event of provider.stream(messages, tools.length > 0 ? tools : undefined, { model: opts.model })) {
        if (event.type === 'delta' && event.content) {
          fullText += event.content;
        } else if (event.type === 'tool_call' && event.toolCall) {
          pending.push(event.toolCall);
        } else if (event.type === 'error') {
          finalText = fullText;
          aborted = true;
          break;
        }
      }

      if (aborted) break;
      if (pending.length === 0) {
        finalText = fullText;
        break;
      }

      messages.push({ role: 'assistant', content: fullText, toolCalls: pending });

      for (const tc of pending) {
        yield { event: 'tool_call', data: { name: tc.name, args: tc.arguments } };
        try {
          const result = (await this.mcpService.callTool(tc.name, tc.arguments)) as McpToolResult;
          const textParts: string[] = [];
          if (result?.content && Array.isArray(result.content)) {
            for (const block of result.content) {
              if (block.type === 'text' && block.text) textParts.push(block.text);
            }
          } else {
            textParts.push(typeof result === 'string' ? result : JSON.stringify(result));
          }
          const resultStr = textParts.join('\n');
          const { annotatedResult } = tracker.addEvidence(tc, resultStr);
          messages.push({ role: 'tool', content: annotatedResult, toolCallId: tc.id });
          yield { event: 'tool_result', data: { name: tc.name, result: resultStr } };
        } catch (err) {
          const errStr = `Error calling tool ${tc.name}: ${String(err)}`;
          messages.push({ role: 'tool', content: errStr, toolCallId: tc.id });
          yield { event: 'tool_result', data: { name: tc.name, result: errStr, isError: true } };
        }
      }
    }

    // The agentic loop ends either when the sub-agent stops calling tools (finalText
    // captured above) OR when it exhausts PICROPHANT_MAX_ITERATIONS while still querying
    // — in which case finalText is empty and the gathered evidence would be discarded.
    // Either way, if we don't have a parseable <verdicts> block, force one synthesis turn
    // with tools disabled so the model must wrap up from the evidence already gathered.
    if (!aborted && !hasVerdictsBlock(finalText)) {
      yield { event: 'status', data: { phase: 'verifying', message: 'Synthesizing verdicts from gathered evidence…' } };
      if (finalText.trim()) messages.push({ role: 'assistant', content: finalText });
      messages.push({ role: 'user', content: SYNTHESIS_PROMPT });

      let synthText = '';
      for await (const event of provider.stream(messages, undefined, { model: opts.model })) {
        if (event.type === 'delta' && event.content) synthText += event.content;
      }
      if (synthText.trim()) finalText = synthText;
    }

    yield { event: 'status', data: { phase: 'verifying', message: 'Verifying anti-evidence excerpts…' } };
    const counterReport = assemble(finalText, tracker, claims);

    // Pass 2: map the inference structure (edges) over the now-grounded claims, as a
    // SEPARATE call with tools disabled. Keeping it separate is the whole point —
    // pass 1's verbatim excerpting (the trust layer) no longer competes with graph
    // bookkeeping, and the provenance is already locked, so edges are a non-destructive
    // overlay. A failed mapping pass must not sink the report; edges are optional.
    if (!aborted) {
      yield { event: 'status', data: { phase: 'verifying', message: 'Mapping inference structure…' } };
      try {
        if (finalText.trim()) messages.push({ role: 'assistant', content: finalText });
        messages.push({ role: 'user', content: buildEdgesPrompt(claims) });
        let edgesText = '';
        for await (const event of provider.stream(messages, undefined, { model: opts.model })) {
          if (event.type === 'delta' && event.content) edgesText += event.content;
        }
        const edges = parseEdges(edgesText, counterReport.counterClaims.length);
        if (edges.length > 0) counterReport.edges = edges;
      } catch {
        // Edges are an optional overlay; a failed mapping pass leaves the report intact.
      }
    }

    const markdown = renderCounterReport(counterReport);
    yield { event: 'done', data: { counterReport, markdown } };
  }

  /** One-shot LLM call to pull load-bearing claims out of raw report text. */
  private async extractClaims(report: string, opts: ChallengeOptions): Promise<string[]> {
    const provider = this.llmService.createProvider(opts.provider, opts.apiKey);
    let full = '';
    for await (const event of provider.stream(
      [{ role: 'user', content: CLAIM_EXTRACT_PROMPT + report }],
      undefined,
      { model: opts.model }
    )) {
      if (event.type === 'delta' && event.content) full += event.content;
    }
    return parseStringArray(full);
  }
}

// ---- helpers ----

/** Whether the sub-agent's output already contains a parseable <verdicts> block. */
function hasVerdictsBlock(text: string): boolean {
  return /<verdicts>[\s\S]*?<\/verdicts>/i.test(text);
}

function errorResult(message: string): ToolCallResult {
  return { content: [{ type: 'text', text: message }], artifacts: [] };
}

function buildChallengePrompt(report: string, claims: string[], focus: string | undefined): string {
  const claimList = claims.map((c, i) => `${i + 1}. ${c}`).join('\n');
  const focusLine = focus ? `\n\nPay special attention to: ${focus}.` : '';
  return `Here is the report to challenge:

<report>
${report}
</report>

Challenge each of these ${claims.length} claim(s), in order:

${claimList}${focusLine}

Query the tools for refuting evidence, then produce your analysis, the <verdicts> block, and the <provenance> block.`;
}

/** Pass 1 result: verify anti-evidence excerpts and parse verdicts into a CounterReport. */
function assemble(finalText: string, tracker: TaintKeyProvenanceTracker, claims: string[]): CounterReport {
  const provenance = tracker.verifyStructuredClaims(finalText);
  const counterClaims = parseVerdicts(finalText, claims);
  return { counterClaims, provenance };
}

/** Extract the first JSON array of strings from LLM output. */
function parseStringArray(text: string): string[] {
  const match = /\[[\s\S]*\]/.exec(text);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
  } catch {
    return [];
  }
}

interface RawVerdict {
  claim?: string;
  verdict?: string;
  unverifiable?: boolean;
  rationale?: string;
  evidenceKeys?: unknown;
}

/**
 * Parse the <verdicts> JSON block. Falls back to one `stands`/unverifiable
 * counter-claim per input claim if the block is missing or malformed, so a
 * sub-agent that skipped the structured output still yields a usable report.
 */
function parseVerdicts(text: string, claims: string[]): CounterClaim[] {
  const match = /<verdicts>([\s\S]*?)<\/verdicts>/i.exec(text);
  let raw: RawVerdict[] = [];
  if (match) {
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) raw = parsed as RawVerdict[];
    } catch {
      raw = [];
    }
  }

  if (raw.length === 0) {
    return claims.map(claim => ({
      claim,
      verdict: 'stands' as ClaimVerdict,
      unverifiable: true,
      rationale: 'No structured verdict was produced for this claim.',
      evidenceKeys: [],
    }));
  }

  return raw.map((r, i) => {
    const verdict = VALID_VERDICTS.includes(r.verdict as ClaimVerdict) ? (r.verdict as ClaimVerdict) : 'stands';
    const evidenceKeys = Array.isArray(r.evidenceKeys)
      ? (r.evidenceKeys as unknown[]).filter((k): k is string => typeof k === 'string')
      : [];
    return {
      claim: typeof r.claim === 'string' && r.claim.trim() ? r.claim : claims[i] ?? `Claim ${i + 1}`,
      verdict,
      unverifiable: r.unverifiable === true,
      rationale: typeof r.rationale === 'string' ? r.rationale : '',
      evidenceKeys,
    };
  });
}

interface RawEdge {
  from?: unknown;
  to?: unknown;
  move?: unknown;
  licensed?: unknown;
  rationale?: unknown;
  evidenceKeys?: unknown;
}

/** Convert a 1-based claim number from the model into a valid 0-based index, or null. */
function toClaimIndex(v: unknown, count: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
  if (!Number.isInteger(n)) return null;
  const idx = n - 1;
  return idx >= 0 && idx < count ? idx : null;
}

/**
 * Parse the optional <edges> JSON block into inference edges over the claims.
 * Drops edges with out-of-range or self-referential endpoints. Returns [] if the
 * block is absent or malformed — edges are supplementary, claims stay primary.
 */
function parseEdges(text: string, claimCount: number): CounterEdge[] {
  const match = /<edges>([\s\S]*?)<\/edges>/i.exec(text);
  if (!match) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const edges: CounterEdge[] = [];
  for (const raw of parsed as RawEdge[]) {
    const from = toClaimIndex(raw.from, claimCount);
    const to = toClaimIndex(raw.to, claimCount);
    if (from === null || to === null || from === to) continue;
    const evidenceKeys = Array.isArray(raw.evidenceKeys)
      ? (raw.evidenceKeys as unknown[]).filter((k): k is string => typeof k === 'string')
      : [];
    edges.push({
      from,
      to,
      move: typeof raw.move === 'string' && raw.move.trim() ? raw.move.trim() : 'inference',
      licensed: raw.licensed !== false, // default to licensed unless explicitly false
      rationale: typeof raw.rationale === 'string' ? raw.rationale : '',
      evidenceKeys,
    });
  }
  return edges;
}

const VERDICT_BADGE: Record<ClaimVerdict, string> = {
  contradicted: '❌ Contradicted',
  weakened: '⚠️ Weakened',
  stands: '✅ Stands',
};

/** Render the structured CounterReport to the markdown returned as the tool result + artifact. */
function renderCounterReport(report: CounterReport): string {
  const { counterClaims, provenance } = report;
  const edges = report.edges ?? [];
  const unwarranted = edges.filter(e => !e.licensed).length;

  const counts = { contradicted: 0, weakened: 0, stands: 0, unverifiable: 0 };
  for (const c of counterClaims) {
    counts[c.verdict]++;
    if (c.unverifiable) counts.unverifiable++;
  }

  // Index verified anti-evidence by taint key for per-claim lookup.
  const evidenceByKey = new Map<string, ClaimEvidence[]>();
  for (const ev of provenance.claims) {
    const list = evidenceByKey.get(ev.evidenceKey) ?? [];
    list.push(ev);
    evidenceByKey.set(ev.evidenceKey, list);
  }
  const store = provenance.evidenceStore;

  const lines: string[] = [];
  lines.push('# Picrophant Counter-Report');
  lines.push('');
  lines.push(
    `> ${counterClaims.length} claim(s) challenged · ` +
      `${counts.contradicted} contradicted · ${counts.weakened} weakened · ${counts.stands} stand · ` +
      `${counts.unverifiable} unverifiable` +
      (edges.length > 0 ? ` · ${edges.length} inference(s), ${unwarranted} unwarranted` : '')
  );
  lines.push('');

  counterClaims.forEach((c, i) => {
    const badge = VERDICT_BADGE[c.verdict] + (c.unverifiable ? ' · 🔍 unverifiable' : '');
    lines.push(`## ${i + 1}. ${c.claim}`);
    lines.push('');
    lines.push(`**Verdict:** ${badge}`);
    lines.push('');
    if (c.rationale) {
      lines.push(c.rationale);
      lines.push('');
    }

    const evidence: ClaimEvidence[] = [];
    for (const key of c.evidenceKeys) {
      for (const ev of evidenceByKey.get(key) ?? []) evidence.push(ev);
    }
    if (evidence.length > 0) {
      lines.push('_Anti-evidence:_');
      for (const ev of evidence) {
        const mark = ev.excerptVerified ? '✓' : '⚠';
        const tool = store[ev.evidenceKey]?.toolName?.split('__').pop() ?? 'tool';
        const sources = ev.sourceIds && ev.sourceIds.length > 0 ? ` — ${ev.sourceIds.join(', ')}` : '';
        const unverified = ev.excerptVerified ? '' : ' _(excerpt not verified against source)_';
        lines.push(`- ${mark} "${ev.excerpt}" (via ${tool})${sources}${unverified}`);
      }
      lines.push('');
    }

    const outgoing = edges.filter(e => e.from === i);
    if (outgoing.length > 0) {
      lines.push('_Infers:_');
      for (const e of outgoing) {
        const lic = e.licensed ? '✓ licensed' : '⚠ unwarranted';
        const target = counterClaims[e.to]?.claim ?? `claim ${e.to + 1}`;
        lines.push(`- → [${e.to + 1}] ${target} _(${e.move})_ — ${lic}${e.rationale ? `: ${e.rationale}` : ''}`);
      }
      lines.push('');
    }
  });

  lines.push('---');
  const verified = provenance.claims.filter(c => c.excerptVerified).length;
  const unverified = provenance.claims.length - verified;
  lines.push(
    `_Verification: ${verified} anti-evidence excerpt(s) verified against source` +
      (unverified > 0 ? `, ${unverified} unverified` : '') +
      `._`
  );

  return lines.join('\n');
}
