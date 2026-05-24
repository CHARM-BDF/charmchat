# Picrophant — Adversarial Counter-Report

An anti-sycophant. Given a report, it actively hunts for **refuting** evidence — the dual of the [taint-key provenance system](DESIGN_TAINT.md), which grounds claims in *supporting* evidence. Where a sycophant shows you the sweet (agrees, confirms), the picrophant shows you the bitter.

## Problem

Reports built from literature — like a PMI physician report recommending therapeutics for a genetic variant — string together a chain of mechanistic and therapeutic claims, each individually cited. The weak joints are rarely the citations; they're the *inferences between* them: mouse model → human, correlation → causation, an n=1 case report → a recommendation. An LLM asked to review such a report tends toward agreement (sycophancy). The picrophant is structurally biased the other way: for each claim, it goes looking for evidence *against*.

The mirror risk is symmetric fabrication: just as a sycophant invents supporting evidence, a contrarian invents refuting evidence. The defense is the same machinery that catches the sycophant — every piece of anti-evidence must carry a valid taint key and a verified excerpt, or it is flagged. The picrophant is a prosecutor who must still enter real exhibits.

## Shape

Picrophant is **a tool the host LLM calls** (`picrophant__challenge_report`), backed by an **in-backend service** that runs its own **agentic sub-agent loop**. It reuses the backend's existing stack rather than standing up a separate process:

| Reuses | For |
|--------|-----|
| `MCPService` (`services/mcp.ts`) | The sub-agent's evidence tools (medik, pubmed, ToolUniverse, …) |
| `LLMService` (`services/llm/`) | The sub-agent's model |
| `TaintKeyProvenanceTracker` (`services/provenance.ts`) | Excerpt-verifying the anti-evidence the sub-agent gathers |

No second process, no duplicated agentic loop, and no second set of evidence subprocesses (ToolUniverse's slow cold-load happens once, in the backend). The tradeoff accepted: picrophant is coupled to CharmChat's backend and is not a portable standalone MCP server.

## Data Flow

```
Host chat loop (chat.ts)
  │  LLM emits tool_call: picrophant__challenge_report({ report, claims?, focus? })
  │
  ▼
callTool() special-cases the name ──→ PicrophantService.challengeReport()
                                          │
                                          │  1. Extract claims (if not provided)
                                          │  2. Spin up sub-agent with own TaintKeyProvenanceTracker
                                          │     tools = mcpService.getTools()  (picrophant absent → recursion guard)
                                          │
                                          ▼
                            ┌──── sub-agent agentic loop ──────┐
                            │  per claim, query for refutation │
                            │  evidence result → tag [ev-XXX]  │
                            │  sub-agent cites [ev-XXX]        │
                            └───────────────┬──────────────────┘
                                            │  3. verifyStructuredClaims()
                                            ▼
                            counter-report (markdown) + verified anti-evidence
                                            │
        returns { content: [...], artifacts: [counter-report md] }
                                            │
  ◀─────────────────────────────────────────┘
Host chat loop tags the whole counter-report as one source [ev-YYY];
host LLM cites it; counter-report also renders in the artifact panel.
```

Verification nests one level down. Inside the call, **picrophant is the host**: it tags each evidence-tool result with `[ev-XXX]`, the sub-agent cites those keys, and picrophant verifies the excerpts before returning. The counter-report comes back *already excerpt-verified*. When it flows up, the outer chat loop taint-keys the whole result as one source the host LLM cites — the two layers compose cleanly.

## Tool Contract

```jsonc
// picrophant__challenge_report — input
{
  "report": "string",          // required: raw report text (markdown ok)
  "claims": ["string", ...],   // optional: pre-extracted claims; skip extraction if present
  "focus": "string"            // optional: aspect to stress-test (e.g. "the BDNF mechanism")
}
```

**Output** (the `{ content, artifacts }` shape `callTool` already returns, so artifact forwarding and taint-keying in `chat.ts` work unchanged):

- `content`: a markdown counter-report — a per-claim section with verdict, rationale, and cited anti-evidence.
- `artifacts`: the same counter-report as a `markdown` artifact, so it gets a home in the artifact panel.

## Verdict Model

Per claim, **three verdicts plus one orthogonal flag**:

| Verdict | Meaning |
|---------|---------|
| `contradicted` | Found evidence directly against the claim |
| `weakened` | Found caveats, limits, or an overreaching inference that undercut it (mouse→human, n=1→recommendation — the *kind* of weakness goes in the rationale, not the enum) |
| `stands` | Looked, found nothing against it |

| Flag | Meaning |
|------|---------|
| `unverifiable` | Could not ground or check the claim at all |

`unverifiable` is kept separate from `stands` on purpose: a claim that *evaded* scrutiny is not the same as one that *survived* it.

The verdict label is the one part of the output that taint keys **cannot** verify — it is an editorial judgment, and therefore the part most exposed to contrarian-for-its-own-sake bias (the mirror of sycophancy). So the taxonomy is kept deliberately coarse; the verified anti-evidence excerpts carry the weight, and the nuance lives in the per-claim rationale prose.

## Sub-Agent

- **Toolset**: the same tools as main chat, *minus picrophant itself*. Because the synthetic `picrophant__challenge_report` definition is appended only in the chat orchestrator's tool list (not inside `MCPService.getTools()`), the sub-agent — which calls `getTools()` directly — never sees it. Recursion guard for free.
- **System prompt**: prosecutorial. Its job is to disconfirm, and to honestly report `stands` / `unverifiable` when refutation isn't found — it is not rewarded for manufacturing dissent.
- **Budget**: cap the number of claims challenged (≈ top 8 most load-bearing) and a total iteration ceiling (reuse the existing `MAX_ITERATIONS` ceiling pattern), since one call can fan out into many tool calls.

## Integration Points

### 1. Expose the tool (`chat.ts`)

Append the synthetic tool definition to the host tool list (around `services/chat.ts:60`):

```typescript
const tools = [
  ...this.mcpService.getTools(options?.blockedServers, options?.blockedTools),
  PicrophantService.toolDefinition(),   // synthetic; NOT in MCPService
];
```

### 2. Route the call (`chat.ts`)

Special-case the name in the tool-execution loop (around `services/chat.ts:162`):

```typescript
const result = tc.name === 'picrophant__challenge_report'
  ? await this.picrophant.challengeReport(tc.arguments, { provider, model: options?.model, apiKey })
  : await this.mcpService.callTool(tc.name, tc.arguments);
```

Everything downstream (artifact forwarding `:200`, taint-keying `:216`, `tool_result` / `trace_entry`) is unchanged — picrophant returns the same `{ content, artifacts }` shape.

### 3. The service (`services/picrophant.ts`, new)

`challengeReport()` extracts claims, runs the sub-agent loop (mirrors the `chat.ts` loop but with a prosecutorial prompt and its own `TaintKeyProvenanceTracker`), verifies excerpts, and assembles the markdown counter-report + artifact.

## Files Changed

### New Files

| File | Description |
|------|-------------|
| `backend/src/services/picrophant.ts` | PicrophantService: claim extraction, sub-agent loop, counter-report assembly, `toolDefinition()` |
| `PICROPHANT.md` | This document |

### Modified Files

| File | Change |
|------|--------|
| `backend/src/services/chat.ts` | Append synthetic tool def; route `picrophant__challenge_report` to the service |
| `backend/src/index.ts` | Construct `PicrophantService`, wire into `ChatService` |
| `backend/src/types/index.ts` | `ClaimVerdict` (`contradicted`/`weakened`/`stands`), `CounterClaim`, `CounterReport` types |

## Open Questions / Deferred

- **Claim extraction quality** — extraction from raw markdown reuses the structured-claims approach; complex reports may extract poorly. No UI to edit extracted claims (v1).
- **Cost/latency** — one `challenge_report` call can be dozens of tool calls and tens of seconds; the budget caps bound but don't eliminate this. Non-replayable (agentic, by choice).
- **Provider for the sub-agent** — v1 inherits the host conversation's provider/model. A dedicated picrophant model is a future option.
- **Surfacing** — v1 returns the counter-report as a tool result + markdown artifact. A dedicated counter-report panel (like the provenance panel) is deferred.
