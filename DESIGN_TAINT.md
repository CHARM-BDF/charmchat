# Taint-Key Provenance System

## Problem

When MCP tools return empty or insufficient results, the LLM fabricates data. Even when tools return data, users can't verify which claims are grounded in tool results vs. hallucinated.

Inline citation tokens (`[ev-XXXXX]` in the response text) don't work in practice -- the LLM clusters them inconsistently and users can't cross-reference a citation key against a 60K knowledge graph dump.

## Approach: Structured Claims with Evidence Extraction

Two layers working together:

1. **Taint keys** on tool results prevent fabrication of evidence sources (the LLM can't forge a valid key)
2. **Structured `<provenance>` block** forces the LLM to extract specific evidence excerpts for each claim, not just point at a blob

```
Tool returns 60K knowledge graph
  → Tag with random key: [ev-a7f3b2]
  → LLM writes its response normally (no inline citations)
  → LLM appends structured provenance block:

<provenance>
[
  {
    "claim": "Androgens upregulate TMPRSS2 expression",
    "evidenceKey": "ev-a7f3b2",
    "excerpt": "UMLS:C0002844 (Androgens) → stimulates → TMPRSS2 gene",
    "sourceIds": ["PMID:12345678"]
  }
]
</provenance>

  → Backend strips <provenance> block from displayed text
  → Backend verifies: ev-a7f3b2 exists? ✓ Excerpt found in evidence? ✓
  → Frontend shows clean response + collapsible claims panel
```

Empty results get **no key** → LLM has nothing to cite → fabricated claims have no valid evidence key.

## Why Two Layers

| Layer | What it catches | How |
|-------|----------------|-----|
| Taint keys | Fabricated evidence sources | Key is random/unforgeable; invalid key = immediate flag |
| Excerpt verification | Fabricated excerpts | Fuzzy string match of excerpt against actual tool result content |
| Structured output | Missing provenance | If LLM skips the block, "no claims" warning shows |

Neither layer alone is sufficient. Keys without excerpts just point at a blob. Excerpts without keys could reference fabricated sources.

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

```
PROVENANCE RULES (MANDATORY):
- Each tool result is prefixed with an evidence key like [ev-a7f3b2].
- If a tool returned [NO DATA], do NOT fabricate results.
- After your response, append a <provenance> block with a JSON array of claims.
- Each claim extracts SPECIFIC supporting evidence, not just a reference.
- Format:
<provenance>
[
  {
    "claim": "Androgens upregulate TMPRSS2 expression",
    "evidenceKey": "ev-a7f3b2",
    "excerpt": "UMLS:C0002844 (Androgens) → stimulates → TMPRSS2 gene",
    "sourceIds": ["PMID:12345678"]
  }
]
</provenance>

- "excerpt": Copy the EXACT relevant fragment from the tool result.
- "sourceIds": PMIDs, DOIs, or identifiers found near the excerpt.
- Do NOT include evidence keys in the main response text.
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

### 3. Before done: Parse provenance block, verify, strip from content

```typescript
const provenanceReport = tracker.verifyStructuredClaims(fullText);
const displayText = stripProvenanceBlock(fullText);
const artifacts = parseArtifacts(displayText);

yield { event: 'provenance', data: provenanceReport };
yield { event: 'done', data: { content: displayText, artifacts, provenanceReport } };
```

## Verification Logic

1. **Parse**: Regex-extract `<provenance>` block, JSON.parse the array
2. **Key check**: For each claim, verify `evidenceKey` exists in the evidence store (deterministic)
3. **Excerpt check**: Normalize both the excerpt and evidence content (lowercase, collapse whitespace, strip punctuation), then check if the excerpt appears in the content. Falls back to 60% partial match for paraphrased excerpts.

## Frontend Display

Collapsible **provenance panel** below each response:

```
✓ 5 verified claims · 1 unverified · 1 unused source
  ├─ ✓ Androgens upregulate TMPRSS2 expression
  │    "UMLS:C0002844 (Androgens) → stimulates → TMPRSS2 gene"
  │    PMID:12345678
  ├─ ✓ IFN-γ stimulates TMPRSS2
  │    "IFN-γ → stimulates → TMPRSS2 gene"
  └─ ⚠ Estrogen may decrease TMPRSS2
       "excerpt not found in source"
```

Each claim shows: verification status, the claim text, the excerpt, and source IDs. No inline badges cluttering the response text.

## Security Properties

**Guaranteed:**
- Taint keys are unforgeable (random, server-side, 24-bit entropy)
- Empty results produce no key -- hallucination over missing data is structurally detectable
- Excerpts are verified against actual tool result content -- fabricated excerpts are caught
- Full evidence store persisted with conversation -- auditable after the fact

**Not prevented:**
- LLM omitting claims (mitigated: uncited keys warning)
- LLM cherry-picking evidence (mitigated: uncited sources shown)
- LLM not producing the `<provenance>` block at all (mitigated: "no claims despite tool use" warning)

## Files Changed

| File | Change |
|------|--------|
| `backend/src/services/provenance.ts` | TaintKeyProvenanceTracker, structured claim parsing, excerpt verification |
| `backend/src/services/chat.ts` | Integrate tracker, strip provenance block, emit verified claims |
| `backend/src/types/index.ts` | EvidenceEntry, ClaimEvidence, ProvenanceReport types |
| `frontend/src/types/index.ts` | Mirror provenance types |
| `frontend/src/stores/chatStore.ts` | Handle `provenance` SSE event |
| `frontend/src/components/chat/MessageBubble.tsx` | ProvenancePanel with claim-level evidence display |
