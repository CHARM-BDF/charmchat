# Picrophant — Adversarial Counter-Report

An anti-sycophant. Given a report, it actively hunts for **refuting** evidence — the dual of the [taint-key provenance system](DESIGN_TAINT.md), which grounds claims in *supporting* evidence. Where a sycophant shows you the sweet (agrees, confirms), the picrophant shows you the bitter.

## Problem

Reports built from literature — like a PMI physician report recommending therapeutics for a genetic variant — string together a chain of mechanistic and therapeutic claims, each individually cited. The weak joints are rarely the citations; they're the *inferences between* them: mouse model → human, correlation → causation, an n=1 case report → a recommendation. An LLM asked to review such a report tends toward agreement (sycophancy). The picrophant is structurally biased the other way: for each claim, it goes looking for evidence *against*.

The mirror risk is symmetric fabrication: just as a sycophant invents supporting evidence, a contrarian invents refuting evidence. The defense is the same machinery that catches the sycophant — every piece of anti-evidence must carry a valid taint key and a verified excerpt, or it is flagged. The picrophant is a prosecutor who must still enter real exhibits.

## Shape

Picrophant is a **dedicated feature**, not a tool the model may or may not call: a **"Challenge" button** in the chat UI hits a **streaming backend route** (`POST /api/picrophant/challenge`) backed by an **in-backend service** that runs its own **agentic sub-agent loop**. It reuses the backend's existing stack rather than standing up a separate process:

| Reuses | For |
|--------|-----|
| `MCPService` (`services/mcp.ts`) | The sub-agent's evidence tools (medik, pubmed, ToolUniverse, …) |
| `LLMService` (`services/llm/`) | The sub-agent's model |
| `TaintKeyProvenanceTracker` (`services/provenance.ts`) | Excerpt-verifying the anti-evidence the sub-agent gathers |

No second process, no duplicated agentic loop, and no second set of evidence subprocesses. Because picrophant is invoked by an explicit user action over its own route — **not** registered as a tool — there is no hidden/undiscoverable tool, no special-case in the chat tool-dispatch loop, and no recursion guard to worry about (the sub-agent's toolset from `MCPService.getTools()` simply never contains picrophant). The tradeoff accepted: picrophant is coupled to CharmChat's backend, not a portable standalone MCP server.

> **History:** v1 wired picrophant as a synthetic tool (`picrophant__challenge_report`) appended to the chat tool list and special-cased in `chat.ts`. In testing the model didn't reliably call it, and a hidden tool that bypasses normal dispatch was an awkward abstraction. v2 (current) replaced that with the button + route below.

## Data Flow

```
"Challenge" button (MessageBubble) — passes the message's existing claims
  │  POST /api/picrophant/challenge { report, claims, provider, model }
  ▼
routes/picrophant.ts ──→ PicrophantService.challengeStream()
                            │  1. Extract claims (skipped — claims passed in)
                            │  2. Sub-agent loop with own TaintKeyProvenanceTracker
                            │     tools = mcpService.getTools() (picrophant not a tool)
                            │
                            ▼
              ┌──── sub-agent agentic loop ──────┐
              │  per claim, query for refutation │
              │  evidence result → tag [ev-XXX]  │
              │  sub-agent cites [ev-XXX]        │
              └───────────────┬──────────────────┘
                              │  3. verifyStructuredClaims()
                              ▼
       SSE stream: status · claims · tool_call · done{counterReport, markdown}
                              │
  ◀───────────────────────────┘
MessageBubble renders progress live, then a CounterReportPanel below the claims.
```

Verification nests one level down. Inside the call, **picrophant is the host**: it tags each evidence-tool result with `[ev-XXX]`, the sub-agent cites those keys, and picrophant verifies the excerpts before returning. The counter-report is *already excerpt-verified* when it streams back.

## Route & Streaming Contract

`POST /api/picrophant/challenge` — request body:

```jsonc
{
  "report": "string",          // required: report text being challenged (the message content)
  "claims": ["string", ...],   // optional: pre-extracted claims; if omitted, extracted from report
  "focus": "string",           // optional: aspect to stress-test
  "provider": "bedrock",       // inherits the conversation's provider/model
  "model": "global.anthropic.claude-sonnet-4-6",
  "apiKey": "…"                // only in BYOK mode
}
```

SSE events (so the UI isn't a silent spinner during the multi-minute run):

| Event | Data | Meaning |
|-------|------|---------|
| `status` | `{ phase, message }` | `extracting` / `querying` (per round) / `verifying` |
| `claims` | `{ claims }` | the claims being challenged |
| `tool_call` | `{ name, args }` | sub-agent issued an evidence query |
| `tool_result` | `{ name, result, isError? }` | that query's result (rendered as an expandable card, like main chat) |
| `done` | `{ counterReport, markdown }` | finished; structured `CounterReport` + rendered markdown |
| `error` | `{ error }` | failed |

`PicrophantService.challengeReport()` remains as a non-streaming drainer of `challengeStream()`, used by the dev harness `backend/run-picrophant.ts`.

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

`unverifiable` is kept separate from `stands` on purpose: a claim that *evaded* scrutiny is not the same as one that *survived* it. The summary counts and per-claim rows both surface it.

The verdict label is the one part of the output that taint keys **cannot** verify — an editorial judgment, and therefore the part most exposed to contrarian-for-its-own-sake bias (the mirror of sycophancy). So the taxonomy is deliberately coarse; the verified anti-evidence excerpts carry the weight, and the nuance lives in the per-claim rationale prose.

## Sub-Agent

- **Toolset**: the same evidence tools as main chat (`MCPService.getTools()`). Picrophant is not a tool, so it can't recurse into itself.
- **System prompt**: prosecutorial (`PICROPHANT_SYSTEM_PROMPT` + the shared `TAINT_KEY_SYSTEM_PROMPT`). Its job is to disconfirm, and to honestly report `stands` / `unverifiable` when refutation isn't found — it is not rewarded for manufacturing dissent.
- **Budget**: caps the number of claims (`MAX_CLAIMS = 8`) and rounds (`PICROPHANT_MAX_ITERATIONS = 10`), since one call fans out into many tool calls.

## UI

The button appears on assistant messages that already have a provenance report with claims, **right after the claims panel**. It challenges those claims *as-is* (no re-extraction, no editing) — phase-1 extraction is skipped because the claims are passed in. While running, it shows the live phase + query count; on completion it renders a `CounterReportPanel` (collapsible, mirroring `ProvenancePanel`) with per-claim verdict badges, rationale, and ✓/⚠ excerpt-verification marks. The counter-report is **ephemeral** in v1 — held in component state, not persisted with the conversation.

## Files Changed

### New Files

| File | Description |
|------|-------------|
| `backend/src/services/picrophant.ts` | `PicrophantService`: claim extraction, streaming sub-agent loop (`challengeStream`), counter-report assembly + rendering |
| `backend/src/routes/picrophant.ts` | `POST /challenge` SSE route (BYOK-aware key resolution) |
| `backend/run-picrophant.ts` | Dev harness: runs a challenge against a report file via Bedrock |
| `PICROPHANT.md` | This document |

### Modified Files

| File | Change |
|------|--------|
| `backend/src/index.ts` | Register the picrophant route |
| `backend/src/services/provenance.ts` | Tightened `TAINT_KEY_SYSTEM_PROMPT` excerpt rule to demand verbatim copies (shared fix — also benefits main chat) |
| `backend/src/types/index.ts` | `ClaimVerdict`, `CounterClaim`, `CounterReport` types |
| `frontend/src/types/index.ts` | Mirror counter-report types |
| `frontend/src/components/chat/MessageBubble.tsx` | "Challenge" button + `CounterReportPanel` after the claims |

## Open Questions / Deferred

- **Persistence** — the counter-report is ephemeral (lost on reload / conversation switch). Persisting it would mean adding it to the `Message` type + storage.
- **Entry points** — today the button only appears on assistant messages that carry provenance claims. A paste-a-report panel (à la WorkflowRunner) for external documents is deferred.
- **Cost/latency** — one challenge can be dozens of tool calls and minutes; the budget caps bound but don't eliminate this. Non-replayable (agentic, by choice).
- **Sub-agent provider** — v1 inherits the conversation's provider/model; a dedicated picrophant model is a future option.
