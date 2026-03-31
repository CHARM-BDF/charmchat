# Taint-Key Provenance System

## Problem

When MCP tools return empty or insufficient results, the LLM fabricates data. Even when tools return data, users can't verify which claims are grounded in tool results vs. hallucinated.

## Approach: Taint Keys + Structured Claims + Inline Citations

Three layers working together:

1. **Taint keys** on tool results prevent fabrication of evidence sources (the LLM can't forge a valid key)
2. **Inline `[ev-XXXXX]` citations** in the response text mark which claims are grounded
3. **Structured `<provenance>` block** forces the LLM to extract specific evidence excerpts for each claim

```
Tool returns 60K knowledge graph
  → Tag with random key: [ev-a7f3b2]
  → LLM writes response with inline keys:
    "Androgens upregulate TMPRSS2 [ev-a7f3b2] through the androgen receptor [ev-a7f3b2]."
  → LLM appends structured provenance block:
    <provenance>[{"claim": "...", "evidenceKey": "ev-a7f3b2", "excerpt": "...", "sourceIds": [...]}]</provenance>
  → Backend strips <provenance> block, keeps inline keys
  → Backend verifies: key exists? ✓ Excerpt found in evidence? ✓
  → Frontend replaces [ev-a7f3b2] with styled superscript [1] linking to claims panel

Tool returns empty
  → No key assigned, [NO DATA] annotation
  → LLM has no key to cite → fabricated claims immediately visible
```

## Why Three Layers

| Layer | What it catches | How |
|-------|----------------|-----|
| Taint keys | Fabricated evidence sources | Key is random/unforgeable; invalid key = immediate flag |
| Inline citations | Ungrounded claims in the response | Claims without `[ev-XXXXX]` have no link — visually obvious |
| Excerpt verification | Fabricated excerpts | Token-based matching of excerpt against actual tool result content |
| Structured output | Missing provenance | If LLM skips the block, "no claims" warning shows |

Neither layer alone is sufficient. Keys without excerpts just point at a blob. Excerpts without keys could reference fabricated sources. Inline keys without the provenance block give no detail.

## Data Flow

```
                    Backend                              Frontend
                    ──────                              ────────
Tool result ──→ Tag with [ev-XXX] ──→ LLM
                                       │
                         ┌─────────────┤
                         │             │
                    inline keys    <provenance> block
                    in response    with claims/excerpts
                         │             │
                         ▼             ▼
                    stripProvenanceBlock()
                    verifyStructuredClaims()
                         │
                    ┌────┴────┐
                    │         │
               displayText  provenanceReport
               (keys kept)  (verified claims)
                    │         │
                    ▼         ▼
               SSE: done   SSE: provenance
                    │         │
                    ▼         ▼
              renderCitationLinks()
              [ev-XXX] → styled [N] superscripts
              matched to claims panel entries
```

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

interface ClaimEvidence {
  claim: string;                      // "Androgens upregulate TMPRSS2"
  evidenceKey: string;                // "ev-a7f3b2"
  excerpt: string;                    // specific fragment from tool result
  sourceIds?: string[];               // PMIDs, DOIs, etc.
  keyValid: boolean;                  // evidence key exists in store
  excerptVerified: boolean;           // excerpt found in evidence content
}

interface ProvenanceReport {
  evidenceStore: Record<string, EvidenceEntry>;
  claims: ClaimEvidence[];
  uncitedKeys: string[];              // evidence keys never referenced
  hasEvidence: boolean;
}
```

## System Prompt

The LLM is instructed to do two things:

1. Place `[ev-XXXXXX]` inline after factual claims (rendered as citation superscripts)
2. Append a `<provenance>` block with structured claim-level evidence

```
PROVENANCE RULES (MANDATORY):
- Each tool result is prefixed with an evidence key like [ev-a7f3b2].
- If a tool returned [NO DATA], do NOT fabricate results.
- In your response, place [ev-XXXXXX] inline after each factual claim it supports.
- After your response, append a <provenance> block with a JSON array:
  [{"claim": "...", "evidenceKey": "ev-...", "excerpt": "...", "sourceIds": [...]}]
- "excerpt": Copy the EXACT relevant fragment from the tool result.
- "sourceIds": PMIDs, DOIs, or identifiers found near the excerpt.
- NEVER invent keys or excerpts.
```

## Integration Points (chat.ts)

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

### 3. Before done: Parse provenance block, verify, emit

```typescript
const provenanceReport = tracker.verifyStructuredClaims(fullText);
const displayText = stripProvenanceBlock(fullText);  // strips <provenance>, keeps [ev-XXX]
const artifacts = parseArtifacts(displayText);

yield { event: 'provenance', data: provenanceReport };
yield { event: 'done', data: { content: displayText, artifacts, provenanceReport } };
```

## Verification Logic

1. **Parse**: Regex-extract `<provenance>` block, JSON.parse the array
2. **Key check**: For each claim, verify `evidenceKey` exists in the evidence store (deterministic)
3. **Excerpt check**: Extract verification tokens from the excerpt (CURIEs like `CHEBI:16330`, PMIDs, relationship labels). Check that 80%+ of tokens appear in the evidence content. This handles the LLM reformatting JSON data into arrow notation.

## Frontend Display

### Inline superscripts

`renderCitationLinks()` replaces `[ev-XXXXXX]` in the response with numbered superscripts:

- Maps each evidence key to its claim index in the provenance report
- Renders as `[1]`, `[2]` etc. with green (verified) or amber (unverified) styling
- Hover shows the claim text

### Collapsible claims panel

Below each response, a collapsible panel shows full details:

```
✓ 7 verified claims · 3 unverified · 2 unused sources
  [1] ✓ Androgens upregulate TMPRSS2 expression
       via get-everything
       "{ source: UMLS:C0002844, target: UMLS:C1336641, label: stimulates }"
       PMID:11322890, PMID:24195515
  [2] ✓ DHT increases expression of TMPRSS2
       via get-everything
       "{ source: CHEBI:16330, target: NCBIGene:7113, label: increases expression of }"
       PMID:20601956, PMID:23708653
  [8] ⚠ Dexamethasone upregulates TMPRSS2
       via get-everything
       excerpt not found in source

  Unused sources
  🔧 get-normalizer-info  Found matches: TMPRSS2...
  🔧 execute_python  Drug/Compound...
```

## Security Properties

**Guaranteed:**
- Taint keys are unforgeable (random, server-side, 24-bit entropy)
- Empty results produce no key -- hallucination over missing data is structurally detectable
- Excerpts are verified against actual tool result content -- fabricated excerpts are caught
- Full evidence store persisted with conversation -- auditable after the fact
- Inline citations are mechanically matched -- no fuzzy text matching needed

**Not prevented:**
- LLM omitting claims (mitigated: uncited keys warning)
- LLM cherry-picking evidence (mitigated: uncited sources shown in panel)
- LLM not producing the `<provenance>` block at all (mitigated: "no claims despite tool use" warning)

## Files Changed

| File | Change |
|------|--------|
| `backend/src/services/provenance.ts` | TaintKeyProvenanceTracker, structured claim parsing, token-based excerpt verification, system prompt |
| `backend/src/services/chat.ts` | Integrate tracker, strip provenance block, emit verified claims |
| `backend/src/types/index.ts` | EvidenceEntry, ClaimEvidence, ProvenanceReport types |
| `frontend/src/types/index.ts` | Mirror provenance types |
| `frontend/src/stores/chatStore.ts` | Handle `provenance` SSE event, use done content for stripping |
| `frontend/src/components/chat/MessageBubble.tsx` | renderCitationLinks (inline superscripts), ProvenancePanel (claims + unused sources) |
