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

Each claim is judged on its **own truth in isolation**, never on how it's used downstream — that's what the [edges](#inference-edges) are for:

| Verdict | Meaning |
|---------|---------|
| `contradicted` | The claim itself is false — evidence directly against what it asserts |
| `weakened` | The claim's *own* support is shaky — thin/heavily-caveated evidence, or it overreaches on its own terms. **Not** used merely because a downstream inference misuses an otherwise-sound fact (that weakness lives on the edge) |
| `stands` | The claim is individually true/supported — even if an inference drawn *from* it is unwarranted |

| Flag | Meaning |
|------|---------|
| `unverifiable` | Could not ground or check the claim at all |

`unverifiable` is kept separate from `stands` on purpose: a claim that *evaded* scrutiny is not the same as one that *survived* it. The summary counts and per-claim rows both surface it.

**`stands` is the expected default.** The adversarial energy goes into the *search* (aggressively query for refutation), but the *verdict* is a neutral fact-check: a well-cited claim that survives the hunt stands — even if its evidence is preclinical or it feeds a shaky downstream inference (those are edge concerns). This is a deliberate correction: the prosecutorial framing kept collapsing every node to `weakened` (8/8), which *buried* the one claim with grounded contradicting evidence among seven true-but-also-`weakened` ones — a wall of `weakened` carries as little signal as a wall of `stands`. The pass-1 prompt now explicitly tells the sub-agent to re-grade if it's weakening nearly everything, so a genuinely-undermined premise (e.g. haploinsufficiency, refuted by a verified Stellacci dominant-negative excerpt) stands out against a field of `stands`.

The verdict label is the one part of the output that taint keys **cannot** verify — an editorial judgment, and therefore the part most exposed to contrarian-for-its-own-sake bias (the mirror of sycophancy). So the taxonomy is deliberately coarse; the verified anti-evidence excerpts carry the weight, and the nuance lives in the per-claim rationale prose.

## Inference Edges

Claims are **primary** — they're the nodes, each with its own verdict. But a literature report is a chain (`omega-3 → ↑ serum BDNF → ↑ central BDNF → ↑ cognition → benefit`), and its weak joints are the *moves between* claims, not the claims themselves. Challenging the endpoint produces the wart we kept hitting: "omega-3 raises serum BDNF" is *true* (stands), yet the verdict reads "weakened" because the real weakness — `serum → central` — has nowhere to attach.

So on top of the claims, the sub-agent emits an optional **`<edges>`** block: the inferential dependencies between claims (a DAG — one claim can feed several). Each `CounterEdge` is `{ from, to, move, licensed, rationale, evidenceKeys }`, where `from`/`to` index into `counterClaims`:

| Field | Meaning |
|-------|---------|
| `move` | the *type* of inferential leap — `serum→central biomarker`, `mouse→human`, `n=1→recommendation`, `mechanism→clinical benefit`, … |
| `licensed` | does the gathered evidence actually warrant the move? `false` = the unwarranted joints, the heart of the critique |
| `evidenceKeys` | anti-evidence (taint keys) that the move fails |

This cleanly splits the taxonomy: **`contradicted` / `stands` / `unverifiable` are node properties** (is the claim itself true?), while the **`weakened`-style "this inference isn't licensed"** judgment moves onto **edges**. The omega-3 node can stay honestly `stands` while the `serum→central` edge out of it is flagged `⚠ unwarranted`. Edges are *additive and optional*: claims keep their existing verdicts and full grounding, and a report with no `<edges>` block renders exactly as before. The design deliberately rejected making edges (or "steps") the primary unit — doing so diluted the round budget, flattened every verdict to "weakened", and demoted real contradictions; see git history for that reverted experiment.

**Two-pass split.** Edges are produced in a **separate, structure-only call** (`buildEdgesPrompt`, tools disabled), run *after* the grounded verdicts/provenance are assembled — not in the same synthesis. This was a deliberate fix: when edge-building shared the final synthesis with verbatim excerpting, grounding degraded run-over-run (12/12 → ~4–7/11 verified excerpts) and node verdicts collapsed to all-`weakened`, because the model spent its budget drawing the graph instead of copying exact excerpts. Splitting the passes means **pass 1 is the trusted layer** (challenge claims → `<verdicts>` + `<provenance>`, identical to the pre-edges behavior that scored 12/12) and **pass 2 is a non-destructive overlay** (the provenance is already locked; edges only read the evidence in context, they can't rewrite it). Cost: one extra LLM call, no extra tool calls.

Because edges reference claim *indices*, they share the same editorial-judgment caveat as the verdict labels — taint keys verify the anti-evidence excerpts, not the graph structure itself.

## Sub-Agent

- **Toolset**: the same evidence tools as main chat (`MCPService.getTools()`). Picrophant is not a tool, so it can't recurse into itself.
- **System prompt**: prosecutorial (`PICROPHANT_SYSTEM_PROMPT` + the shared `TAINT_KEY_SYSTEM_PROMPT`). It judges each claim on its own truth and honestly reports `stands` / `unverifiable` when refutation isn't found — it is not rewarded for manufacturing dissent. Pass-1 output order: analysis · `<verdicts>` · `<provenance>` (edges come in pass 2, see [Inference Edges](#inference-edges)).
- **Budget**: caps the number of claims (`MAX_CLAIMS = 8`) and rounds (`PICROPHANT_MAX_ITERATIONS = 10`), since one call fans out into many tool calls.
- **Forced synthesis**: the agentic loop only captures `finalText` on a turn that stops calling tools. If the sub-agent burns its whole round budget still querying, it would exit with no `<verdicts>` block and the gathered evidence would be discarded (symptom: every claim "stands · unverifiable", `0 of 0` anti-evidence). So after the loop, if there's no parseable `<verdicts>` block, one final turn runs with **tools disabled** (`SYNTHESIS_PROMPT`), forcing the model to decide from the evidence already gathered. This also rescues a final answer that omitted the verdicts block.

## UI

There are **two ways in**, both hitting the same route and rendering the same `CounterReportPanel`:

1. **Per-message button** — appears on assistant messages that already have a provenance report with claims, **right after the claims panel**. It challenges those claims *as-is* (no re-extraction, no editing) — phase-1 extraction is skipped because the claims are passed in. The result is persisted onto that message via `saveChallengeResult`.

2. **Conversational challenge mode** — a mode picker in the chat input (`ChatInput`), so you can challenge from a *fresh* chat or mid-conversation, not only off an existing report:
   - **Challenge this message** — the text you type **is** the report; claims are extracted from it (phase-1 runs). Use it to paste a claim/report and stress-test it cold.
   - **Challenge last reply** — challenges the most recent assistant message (its provenance claims if it has them, else extracted). Any text you type is passed as the `focus` hint; sending with an empty box is allowed.

   In both, `chatStore.sendChallenge(content, target)` streams progress through the normal chat streaming state (status line + live `ToolCallList`) and, on `done`, appends the counter-report as a new **assistant reply** carrying `counterReport` / `challengeToolCalls`.

While running, either path shows the live phase + the evidence queries as expandable cards (args + result, reusing `ToolCallList` from the main chat flow); on completion it renders a `CounterReportPanel` (collapsible, mirroring `ProvenancePanel`). When the report carries edges, the panel offers two views (toggle, defaults to **Map**):

- **Map** — `CounterGraph` (lazy-loaded `reagraph` `GraphCanvas`, kept out of the main bundle): the argument as a directed, draggable **force-directed** graph. Claim nodes are colored by their own-truth verdict (green `stands` · amber `weakened` · red `contradicted` · grey `unverifiable`); inference edges are arrowed and colored + dashed by `licensed` (solid green) vs `unwarranted` (dashed amber), with the `move` as the edge label. Click a node for its claim + rationale. (Not a top-down tree: reagraph's hierarchical/tree layouts use `d3-hierarchy.stratify()`, which throws on convergent DAGs — a node with >1 parent — so the scene renders empty; force-directed handles the convergence that's typical here.)
- **List** — per-claim verdict badges, rationale, ✓/⚠ excerpt-verification marks, and outgoing edges as indented cross-references (`↳ infers [N] … · move chip · ✓ licensed / ⚠ unwarranted`) with their own anti-evidence, kept visually subordinate so claims stay primary.

The summary line tallies unwarranted inferences. The counter-report and its tool calls are **persisted onto the message** (`counterReport` / `challengeToolCalls`), so they survive navigation and reload. `MessageBubble` renders any persisted `counterReport` as a standalone block, independent of whether the message has its own provenance report.

## Files Changed

### New Files

| File | Description |
|------|-------------|
| `backend/src/services/picrophant.ts` | `PicrophantService`: claim extraction, streaming sub-agent loop (`challengeStream`), counter-report assembly + rendering |
| `backend/src/routes/picrophant.ts` | `POST /challenge` SSE route (BYOK-aware key resolution) |
| `backend/run-picrophant.ts` | Dev harness: runs a challenge against a report file via Bedrock |
| `frontend/src/components/chat/CounterGraph.tsx` | Lazy `reagraph` Map view: claims as nodes (colored by verdict), inference edges as the DAG |
| `PICROPHANT.md` | This document |

### Modified Files

| File | Change |
|------|--------|
| `backend/src/index.ts` | Register the picrophant route |
| `backend/src/services/provenance.ts` | Tightened `TAINT_KEY_SYSTEM_PROMPT` excerpt rule to demand verbatim copies (shared fix — also benefits main chat) |
| `backend/src/types/index.ts` | `ClaimVerdict`, `CounterClaim`, `CounterEdge`, `CounterReport` (carries optional `edges`) types; `counterReport` / `challengeToolCalls` on `Message` |
| `frontend/src/types/index.ts` | Mirror counter-report + `CounterEdge` types + the two `Message` fields |
| `frontend/src/stores/chatStore.ts` | `saveChallengeResult` (button) + `sendChallenge` (conversational mode) — both persist the counter-report onto a message |
| `frontend/src/components/chat/ChatInput.tsx` | Mode picker (Chat / Challenge this message / Challenge last reply) wired to `sendChallenge` |
| `frontend/src/components/chat/MessageBubble.tsx` | "Challenge" button, `ToolCallList`, `CounterReportPanel`; renders any persisted counter-report as a standalone block |

## Open Questions / Deferred

- **Re-challenge** — once a message carries a persisted counter-report the button is replaced by the report; there's no UI to re-run. Could add a small "re-challenge" affordance.
- **Cost/latency** — one challenge can be dozens of tool calls and minutes; the budget caps bound but don't eliminate this. Non-replayable (agentic, by choice).
- **Sub-agent provider** — v1 inherits the conversation's provider/model; a dedicated picrophant model is a future option.
