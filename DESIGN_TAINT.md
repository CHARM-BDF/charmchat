# Taint-Key Provenance System

## Problem

When MCP tools return empty or insufficient results, the LLM receives an empty string as the tool result and fabricates plausible-looking data with full confidence. Users have no way to distinguish tool-backed facts from hallucinated content.

Prompt-based mitigations ("don't hallucinate") are unreliable -- they depend on LLM compliance. Post-hoc LLM verification (asking another LLM "did this hallucinate?") is also unreliable -- LLMs checking LLMs has the same fundamental problem.

## Insight

Attach **random, unforgeable taint keys** to tool evidence. Force the LLM to cite these keys inline. Then **mechanically verify** cited keys exist in the evidence store.

The LLM cannot forge a valid key for fabricated data. If it hallucinates, the claim either has no key (flagged as ungrounded) or an invalid key (flagged as invalid). Empty tool results get no key at all -- the LLM has nothing to cite.

```
Tool returns data
  → Tag with random key: [ev-a7f3b2] Patient John Doe, age 45
  → Store in evidence map: ev-a7f3b2 → { toolName, content, ... }
  → LLM sees keyed result in message history
  → LLM responds: "The patient is 45 years old [ev-a7f3b2]"
  → Verify: ev-a7f3b2 exists? ✓

Tool returns empty
  → No key assigned, [NO DATA] annotation
  → LLM has no key to cite
  → Any factual claim about this data → immediately flagged as ungrounded
```

## Design Decisions

| Question | Decision | Why |
|----------|----------|-----|
| Key granularity | One key per tool call | Most tools return a coherent unit. Sub-chunking is a future enhancement. |
| Key format | Prefix: `[ev-a7f3b2] result text` | Avoids collision with `<artifact>` XML parsing. Easy to regex-extract from LLM output. |
| Key generation | `crypto.randomBytes(3).toString('hex')` | 6 hex chars = 16.7M possibilities. Unguessable by the LLM. |
| Verification timing | Post-hoc, after full response, before `done` event | Fits existing `parseArtifacts` pattern. No streaming disruption. |
| Verification depth | Level 1 (key existence) always; Level 2 (semantic match) opt-in | Level 1 is deterministic and free. Level 2 needs an LLM call. |
| Uncited claims | Flagged as "ungrounded" in UI, not blocked | Legitimate reasoning doesn't need citations. User decides. |
| Empty results | No key + `[NO DATA]` annotation | No key = nothing to cite = hallucination structurally visible. |
| LLM vs frontend | LLM sees keyed results. Frontend gets original unkeyed text. | Keys are an internal backend↔LLM contract. |

## Data Structures

```typescript
interface EvidenceEntry {
  key: string;                        // "ev-a7f3b2"
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  content: string;                    // raw tool result
  isEmpty: boolean;
  timestamp: string;
}

interface CitationVerification {
  key: string;                        // key cited by LLM
  valid: boolean;                     // exists in evidence store?
  evidenceEntry?: EvidenceEntry;      // what it maps to (if valid)
  claimText?: string;                 // text surrounding the citation
}

interface ProvenanceReport {
  evidenceStore: Record<string, EvidenceEntry>;
  citations: CitationVerification[];
  uncitedKeys: string[];              // evidence never referenced by LLM
  ungroundedSegments: number;         // response segments with no citation
  allCitationsValid: boolean;
  hasEvidence: boolean;               // true if any tool returned data
}
```

## System Prompt (LLM Citation Instructions)

```
CITATION RULES (MANDATORY):
- Each tool result is prefixed with an evidence key like [ev-a7f3b2].
- When you make ANY factual claim based on tool data, you MUST include the
  evidence key inline: "The patient is 45 years old [ev-a7f3b2]."
- Place the key immediately after the specific claim it supports.
- You may cite the same key multiple times.
- If a tool returned [NO DATA], do NOT fabricate results. Tell the user no
  data was found.
- For your own reasoning or general knowledge, do NOT include any key.
- NEVER invent or guess evidence keys. Only use keys from tool results.
```

## Integration Points (chat.ts agentic loop)

### 1. Start of run(): Create tracker, extend system prompt

```typescript
const tracker = new TaintKeyProvenanceTracker();
const allMessages: ChatMessage[] = [
  { role: 'system', content: SYSTEM_PROMPT + TAINT_KEY_SYSTEM_PROMPT },
  ...messages,
];
```

### 2. After each tool call: Tag result with taint key

```typescript
const { key, annotatedResult } = tracker.addEvidence(tc, resultStr);

// Frontend sees original result (clean):
yield { event: 'tool_result', data: { toolCallId, name, result: resultStr } };

// LLM sees keyed result (tainted):
allMessages.push({ role: 'tool', content: annotatedResult, toolCallId: tc.id });
```

### 3. Before done: Verify response and emit provenance

```typescript
const report = tracker.verifyResponse(fullText);
yield { event: 'provenance', data: report };
yield { event: 'done', data: { content: fullText, artifacts, provenanceReport: report } };
```

## SSE Event Flow

```
delta* → tool_call → tool_result → trace_entry →
  [more iterations...] →
delta* → provenance → done
```

## Frontend Display

1. **Citation badges inline**: Replace `[ev-XXXXXX]` in rendered text with small styled badges. Green = valid key, red = invalid key.

2. **Provenance summary bar** (below response):
   ```
   ✓ 4 grounded | 2 ungrounded | All citations valid
   ```
   Warning variant when citations are invalid or zero citations despite tool use.

3. **Evidence panel**: Collapsible `<details>` listing all evidence entries with their tool name, content snippet, and which claims cited them.

## Security Properties

**Guaranteed:**
- Keys are unforgeable (random, server-side, 24-bit entropy)
- Empty results produce no key -- hallucination over missing data is structurally detectable
- Full evidence store persisted -- every citation is auditable after the fact

**Not prevented:**
- LLM cherry-picking evidence (mitigated: uncited keys shown in evidence panel)
- LLM paraphrasing inaccurately with valid key (mitigated: Level 2 semantic verification)
- General-knowledge claims without keys (mitigated: flagged as ungrounded)

## Files Changed

| File | Change |
|------|--------|
| `backend/src/services/provenance.ts` | TaintKeyProvenanceTracker, key generation, verification, system prompt |
| `backend/src/services/chat.ts` | Integrate tracker at 3 points in agentic loop |
| `backend/src/types/index.ts` | Add provenance types; extend Message, SSEEvent |
| `frontend/src/types/index.ts` | Mirror provenance types; extend Message |
| `frontend/src/stores/chatStore.ts` | Handle `provenance` SSE event |
| `frontend/src/components/chat/MessageBubble.tsx` | Citation badges, provenance bar, evidence panel |
