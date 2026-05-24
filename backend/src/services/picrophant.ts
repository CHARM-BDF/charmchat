import type {
  ChatMessage,
  ProviderName,
  ToolCall,
  ClaimVerdict,
  CounterClaim,
  CounterReport,
  ClaimEvidence,
} from '../types/index.js';
import { LLMService } from './llm/index.js';
import { MCPService } from './mcp.js';
import { TaintKeyProvenanceTracker, TAINT_KEY_SYSTEM_PROMPT } from './provenance.js';

const PICROPHANT_MAX_ITERATIONS = 16;
const MAX_CLAIMS = 8;
const VALID_VERDICTS: ClaimVerdict[] = ['contradicted', 'weakened', 'stands'];

const CLAIM_EXTRACT_PROMPT = `Extract the distinct, load-bearing claims from the report below — the mechanistic and therapeutic assertions whose truth the report's conclusions depend on. Prefer inferential claims ("X causes Y", "drug Z improves condition W") over background facts. Return ONLY a JSON array of strings, at most ${MAX_CLAIMS}, most load-bearing first. No prose.

REPORT:
`;

const PICROPHANT_SYSTEM_PROMPT = `You are Picrophant, an adversarial scientific reviewer — the structural opposite of a sycophant. You are given a report and a list of its key claims. For each claim, actively search the available tools (literature, knowledge graphs, databases) for evidence that REFUTES or WEAKENS it.

For each claim:
- Formulate disconfirming queries: contradicting findings, failed replications, alternative explanations, model/population mismatches (e.g. mouse-only evidence extrapolated to humans), small-sample or single-case generalizations, and confounds.
- Ground every factual statement in tool results. Do NOT rely on your own background knowledge for factual claims.

Assign each claim exactly one verdict:
- "contradicted": you found evidence directly against the claim.
- "weakened": you found caveats, limits, or an overreaching inference that undercut it. Put the KIND of weakness (e.g. mouse→human, n=1→recommendation, correlation→causation) in the rationale.
- "stands": you looked and found nothing against it.
Separately, set "unverifiable": true if you could not ground or check the claim at all. This is ORTHOGONAL to the verdict — never label an unchecked claim "stands".

Be honest. You are NOT rewarded for manufacturing dissent. If a claim holds up, say it stands. If you cannot check it, mark it unverifiable.

When finished querying, output, in this order:
1. A brief markdown analysis — one short paragraph per claim — with [ev-XXXXXX] evidence keys inline.
2. A <verdicts> block: a JSON array, one object per claim, in the SAME ORDER the claims were given:
<verdicts>
[
  {"claim": "<the claim text>", "verdict": "weakened", "unverifiable": false, "rationale": "<why, naming the kind of weakness>", "evidenceKeys": ["ev-a1b2c3"]}
]
</verdicts>
"evidenceKeys" are the [ev-XXXXXX] keys of the anti-evidence behind your verdict (empty array if the claim stands or is unverifiable with no evidence).`;

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
  event: 'status' | 'claims' | 'tool_call' | 'done' | 'error';
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
        } catch (err) {
          messages.push({ role: 'tool', content: `Error calling tool ${tc.name}: ${String(err)}`, toolCallId: tc.id });
        }
      }
    }

    yield { event: 'status', data: { phase: 'verifying', message: 'Verifying anti-evidence excerpts…' } };
    const counterReport = assemble(finalText, tracker, claims);
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

/** Verify anti-evidence excerpts and parse verdicts into a CounterReport. */
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

const VERDICT_BADGE: Record<ClaimVerdict, string> = {
  contradicted: '❌ Contradicted',
  weakened: '⚠️ Weakened',
  stands: '✅ Stands',
};

/** Render the structured CounterReport to the markdown returned as the tool result + artifact. */
function renderCounterReport(report: CounterReport): string {
  const { counterClaims, provenance } = report;

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
      `${counts.unverifiable} unverifiable`
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
