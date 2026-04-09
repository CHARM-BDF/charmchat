# LemmaScript Candidates — CharmChat (Dafny Backend)

Case study: formally verifying pure logic extracted from CharmChat using
LemmaScript's Dafny backend.

---

## Tier 1 — Excellent Fit

These are pure functions with rich verifiable properties and direct mapping to
LemmaScript's supported fragment (arrays, numbers, strings, discriminated unions,
loops with invariants).

### 1. Topological Sort (`workflow.ts:379-420`) ✅ VERIFIED

**What it does:** Kahn's algorithm — takes workflow nodes + dependency map,
returns nodes in dependency order or throws on cycle.

**Verification result:** 13 verified, 0 errors, 0 axioms. Verifies from
the **unmodified production TypeScript** — no rewrite needed. Code generation
required 10 new LemmaScript features (Map destructuring, optional chaining,
`Array.shift()`, null coalescing, non-null assertion, `throw`, Map-from-array
constructor, cross-file type resolution, `Record<K,V>`, `as T` stripping).

**TS annotations added:** `//@ verify`, `//@ ensures \result.length <= nodes.length`,
3 ghost variables (`remDeps`, `processed`, `enqueued`).

**Properties proved:**
- Memory safety: every `nodeMap[id]` access is in-domain ✅
- Output bounded: `|result| <= |nodes|` ✅
- Completeness: `|result| == |nodes|` for acyclic graphs (via ranking witness) ✅
- Termination: main loop always finishes ✅
- No double-enqueue: each node enters queue at most once ✅
- SetToSeq correctness (uniqueness, completeness, cardinality) ✅

**Not proved:**
- Output is a permutation of input nodes
- Ordering respects dependencies

**Proof infrastructure:** 5 helper lemmas, `IsRanking` acyclicity predicate,
`AllNodesEnqueued` completeness lemma, adjacency-reverse invariant. The proof
takes >120s (slow for CI; gen-checked only in CI, verified locally).

**Modeling notes (updated):** No rewrite was needed. The production code's `Map`
and `Set` types translated directly to Dafny `map` and `set`. The main proof
challenge was the integer-set gap: `inDegree` (integer counter) vs `remDeps`
(ghost set tracking which deps remain). Ghost variables bridge this.

---

### 2. `resolvePath` — Dotted Path Traversal (`workflow.ts:488-504`)

**What it does:** Given a dotted ref like `"step1.curie"` and an outputs map,
walks the object graph to resolve the value.

**Why it's a great candidate:**
- Small, self-contained, pure function
- Recursive descent over a path with clear base/step cases
- Natural `decreases` on path length

**Properties to verify:**
- Returns `undefined` iff any segment is missing
- For a single-segment path, equivalent to a direct map lookup
- Idempotent: `resolvePath("x", {x: v}) === v`

**Modeling notes:** Model the nested value as a Dafny `datatype Value = Leaf(s: string) | Dict(m: map<string, Value>) | Undef`. Path is `seq<string>`.

---

### 3. `isEmptyResult` — Empty-Result Predicate (`provenance.ts:8-15`) ✅ VERIFIED

**What it does:** Checks whether a tool result string is semantically empty
(blank, `{}`, `[]`, `null`, etc.).

**Verification result:** 3 verified, 0 errors, 0 axioms, <1s. First function
verified in the case study. Required 2 new LemmaScript features (string
truthiness, `String.trim()`).

**TS annotations added:** `//@ verify`, 8 `//@ ensures` clauses.

**Properties proved:**
- `isEmptyResult("") === true` ✅
- `isEmptyResult("{}") === true`, and all other sentinel values ✅
- `isEmptyResult('{"content":[]}') === true` (string escaping works) ✅
- `result.trim() === sentinel ==> true` for all sentinels ✅

---

### 4. Provenance Claim Verification — 80% Token Threshold (`provenance.ts:95-144`)

**What it does:** For each claim, checks whether >= 80% of its verification
tokens appear in the evidence content. Tracks cited vs uncited keys.

**Why it's a great candidate:**
- Core trust/safety logic — highest-value target for formal verification
- The 80% threshold is a pure numeric computation over arrays
- The cited/uncited key tracking is set membership logic

**Properties to verify:**
- A claim is marked `excerptVerified` iff `matched.length >= ceil(tokens.length * 0.8)`
- A claim is marked `keyValid` iff its evidence key exists and is non-empty
- `uncitedKeys` = evidence keys that exist, are non-empty, and are not referenced by any claim
- `uncitedKeys` and `citedKeys` partition the non-empty evidence store
- If a key is invalid, the claim's `excerptVerified` is always `false`

**Modeling notes:** Abstract away regex-based token extraction — model
`extractVerificationTokens` as a specification-level function that returns
`seq<string>`. Focus verification on the threshold arithmetic and set logic.

**LemmaScript sketch:**
```typescript
function verifyExcerpt(tokens: string[], evidenceContent: string): boolean {
  //@ requires tokens.length > 0
  //@ ensures \result === (countMatches(tokens, evidenceContent) >= Math.ceil(tokens.length * 0.8))
  let matched = 0;
  let i = 0;
  while (i < tokens.length) {
    //@ invariant 0 <= i && i <= tokens.length
    //@ invariant matched === countMatches(tokens.slice(0, i), evidenceContent)
    //@ decreases tokens.length - i
    if (evidenceContent.includes(tokens[i])) { matched = matched + 1; }
    i = i + 1;
  }
  return matched >= Math.ceil(tokens.length * 0.8);
}
```

---

## Tier 2 — Good Fit (Some Adaptation Needed)

Functions that are mostly pure but need modeling abstractions to handle features
outside LS's fragment (regex, `JSON.parse`, `Map` with string keys).

### 5. `buildDependencyMap` + `findTemplateRefs` (`workflow.ts:338-377`)

**What it does:** Scans all node arguments for `{{stepN.path}}` template
references and builds a dependency map (which node depends on which).

**Adaptation needed:** The template-ref extraction uses regex. Model it as a
spec-level `extractRefs(s: string): seq<string>` and verify the graph
construction logic around it.

**Properties to verify:**
- Every dependency in the map references a valid node ID (not `input`, not unknown)
- The dependency relation is a subset of the declared node IDs
- Self-dependencies are impossible (a node cannot depend on itself via templates)

---

### 6. `renderCitationLinks` — Key-to-Claim Mapping (`citations.ts:8-36`)

**What it does:** Replaces `[ev-XXXXXX]` markers in text with numbered
superscripts, cycling through claims that share a key.

**Adaptation needed:** Regex replacement → model as iterating over a
`seq<EvidenceRef>` of found markers and resolving each.

**Properties to verify:**
- Every evidence key maps to a valid claim index (or shows `[?]`)
- Claim indices are within bounds of the claims array
- Counter cycling is correct: for a key with N claims, the Kth occurrence maps to `min(K, N-1)`
- No evidence key is silently dropped

---

### 7. `parseToolOutput` — Structured Output Extraction (`workflow.ts:513-540`)

**What it does:** Tries to parse a tool result string as JSON, falling back to
extracting embedded JSON arrays/objects, with single-element array unwrapping.

**Adaptation needed:** `JSON.parse` isn't in LS's fragment. Model as a
spec-level `parseJSON(s): Option<Value>` and verify the fallback/unwrap logic.

**Properties to verify:**
- Single-element arrays are always unwrapped: `parse("[{\"x\":1}]")` returns the object, not the array
- If the string is valid JSON, the result matches direct parse (no information loss)
- The function is total (always returns something — worst case the raw string)

---

### 8. Workflow Execution — Failure Cascade Logic (`workflow.ts:140-166`)

**What it does:** During DAG execution, if a node fails, all downstream
dependents are skipped. Tracks `failedNodes` set and propagates.

**Adaptation needed:** Extract the pure cascade logic from the async execution
context. Model as a function over the sorted node list + dep map.

**Properties to verify:**
- If node A fails and B depends on A, then B is marked as failed
- Transitive: if A fails, B depends on A, C depends on B → C is also skipped
- Non-failed nodes with all-satisfied dependencies are executed (no false skips)
- `overallStatus` is `'error'` iff every node failed; `'partial'` iff some but not all failed

---

## Tier 3 — Stretch Goals / Modeling Exercises

These require more creative modeling but would demonstrate LS on real system-level
properties.

### 9. Chat Agentic Loop Termination (`chat.ts:64-268`)

**What it does:** Loops LLM calls + tool execution up to `MAX_ITERATIONS = 10`.

**Property:** The loop always terminates within 10 iterations. Model as a
state machine with `iteration` counter and prove `iteration` is strictly
increasing and bounded.

---

### 10. Taint-Key Integrity (`provenance.ts:43-89`)

**What it does:** Every non-empty tool result gets a unique `ev-XXXXXX` key
prepended. The LLM can only cite keys that were actually issued.

**Properties to verify (system-level):**
- Every key in the evidence store was generated by `addEvidence`
- The annotated result always starts with `[ev-XXXXXX] ` for non-empty results
- A key appears in the store at most once (uniqueness, modulo collision probability)

---

## Status

| Step | Candidate | Status |
|------|-----------|--------|
| 1 | `isEmptyResult` | ✅ 3 verified, 0 errors, <1s |
| 2 | `topologicalSort` | ✅ 13 verified, 0 errors, >120s |
| 3 | `resolvePath` | Needs `unknown`/Value ADT modeling |
| 4 | Provenance 80% threshold | Needs `Math.ceil`, float→int |
| 5 | Failure cascade | Needs generator extraction |

---

## Shared Type Modeling

These CharmChat types map cleanly to Dafny datatypes:

```dafny
datatype WorkflowNode = WorkflowNode(id: string, tool: string, args: map<string, string>)

datatype Value = Str(s: string) | Num(n: int) | Arr(elems: seq<Value>)
              | Dict(fields: map<string, Value>) | Undef

datatype ClaimResult = ClaimResult(keyValid: bool, excerptVerified: bool)

datatype ExecStatus = Success | Partial | Error
```

The `ProviderName` type is a string literal union → Dafny enum:
```dafny
datatype ProviderName = Anthropic | Bedrock | OpenAI | Gemini | Vertex | Ollama
```
