# LemmaScript TODO — CharmChat Verification (Dafny Backend)

Gap analysis: what LemmaScript needs to verify CharmChat candidates from
LS_CANDIDATES.md. Organized by feature, not by candidate. Each item lists
which candidates it unblocks.

Candidates are numbered as in LS_CANDIDATES.md:
1. topologicalSort, 2. resolvePath, 3. isEmptyResult,
4. provenance 80% threshold, 5. buildDependencyMap,
6. renderCitationLinks, 7. parseToolOutput, 8. failure cascade

---

## Tier 0 — Prerequisite for brownfield use

### 0. Selective extraction: `//@ verify` directive ✅ DONE

**Needed by:** all candidates (any brownfield file)

Running `lsc gen` on a file that mixes annotated and unannotated functions
crashes on the first unsupported construct in an unannotated function (regex,
class, `typeof`, etc.). Real codebases are brownfield — most functions won't
be in the LS fragment.

**Solution implemented:** `//@ verify` directive. If any function in the file
has `//@ verify`, lsc switches to selective mode and only extracts functions
marked with `//@ verify`. Files without any `//@ verify` extract all functions
(backwards-compatible with existing examples). Type/interface declarations are
always extracted.

---

## Tier A — Small additions that unblock Tier 1 candidates

### A1. String truthiness: `!stringVar` ✅ DONE

**Needed by:** #3 isEmptyResult

`isEmptyResult` line 9: `if (!result) return true;` — JS truthy coercion
on a string. For `string` parameters, `!s` is equivalent to `s === ""`.

**What to do:** In resolve or transform, when `!` is applied to a `string`-typed
expression, emit `s == ""` (Dafny) / `s = ""` (Lean) instead of `!s`.

**Scope:** Small — one case in the unary-op handler.

---

### A2. `String.trim()` method ✅ DONE

**Needed by:** #3 isEmptyResult

`isEmptyResult` line 10: `const trimmed = result.trim();`

Currently supported string methods: `indexOf`, `slice`, `length`. No `trim`.

**What to do (Dafny):** Add `trim` to the method dispatch table. Emit as a
call to a helper `StringTrim(s: string): string` injected in the preamble
(like `StringIndexOf`). Axioms:

```dafny
function StringTrim(s: string): string
  ensures |StringTrim(s)| <= |s|
  ensures StringTrim("") == ""
  ensures StringTrim(StringTrim(s)) == StringTrim(s)   // idempotent
```

For `isEmptyResult` verification, the axioms above plus string equality
are sufficient — we only compare `trimmed` against specific constants.

A full character-level definition is possible but not needed yet.

**Scope:** Medium — new preamble helper, method dispatch entry, axioms.

---

### A3. `String.includes(sub)` (substring search)

**Needed by:** #4 provenance 80% threshold

`provenance.ts` line 111: `tokens.filter(t => contentLower.includes(t))`
and line 119: `entry.content.toLowerCase().includes(cleaned.toLowerCase())`.

`arr.includes(x)` (element membership) is already supported. But
`string.includes(sub)` (substring search) is not. It's equivalent to
`s.indexOf(sub) !== -1`.

**What to do:** Add `string.includes` to method dispatch. Emit as
`StringIndexOf(s, sub) != -1` (reusing the existing `StringIndexOf` helper)
or a dedicated `StringContains(s, sub): bool` helper.

**Scope:** Small — dispatch entry + optional preamble alias.

---

### A4. `String.toLowerCase()`

**Needed by:** #4 provenance 80% threshold

`provenance.ts` line 110: `entry.content.toLowerCase()`.

**What to do (Dafny):** Add `toLowerCase` to method dispatch. Emit as
`StringToLower(s: string): string` preamble helper with axioms:

```dafny
function StringToLower(s: string): string
  ensures |StringToLower(s)| == |s|
  ensures StringToLower(StringToLower(s)) == StringToLower(s)
```

For verification purposes, the key property is length preservation and
idempotence. Character-level semantics can be deferred.

**Scope:** Medium — same pattern as `StringTrim`.

---

### A5. `Math.ceil()` and integer percentage threshold

**Needed by:** #4 provenance 80% threshold

`provenance.ts` line 113: `matched.length >= Math.ceil(tokens.length * 0.8)`.

Two sub-issues:
1. `Math.ceil` is not in the fragment.
2. `* 0.8` is floating-point; LS models numbers as integers.

**What to do:** The 80% threshold can be rewritten as pure integer arithmetic:
`matched * 5 >= tokens * 4` (equivalent to `matched/tokens >= 4/5`). But this
requires changing the TS, which the user may not want.

Alternative: model `Math.ceil(x * 0.8)` as a spec-level Dafny function:
```dafny
function CeilFrac(n: int, num: int, den: int): int
  requires den > 0
{ (n * num + den - 1) / den }
```
and emit `Math.ceil(tokens.length * 0.8)` as `CeilFrac(tokens.length, 4, 5)`.

**Scope:** Medium — special-case pattern recognition in transform + preamble.

---

## Tier B — Larger additions for Tier 1-2 candidates

### B1. `String.split(delim)` → `seq<string>`

**Needed by:** #2 resolvePath

`workflow.ts` line 489: `const parts = ref.split('.');`

**What to do (Dafny):** `StringSplit(s: string, delim: string): seq<string>`
preamble helper. Axioms:
- `|StringSplit(s, d)| >= 1`
- Concatenating with delimiter recovers original (spec-level)

**Scope:** Medium — preamble helper + dispatch entry.

---

### B2. `arr.slice(start)` (single-arg overload)

**Needed by:** #2 resolvePath

`workflow.ts` line 491: `const valuePath = parts.slice(1);`

LS supports `s.slice(start, end)` for strings. Array slice is not listed.

**What to do:** Add `array.slice(start)` and `array.slice(start, end)` to
array method dispatch. Dafny: `arr[start..]` / `arr[start..end]`.

**Scope:** Small — dispatch entry, Dafny slice syntax is native.

---

### B3. Map destructuring iteration: `for (const [k, v] of map)`

**Needed by:** #1 topologicalSort, #8 failure cascade

`workflow.ts` line 392: `for (const [nodeId, nodeDeps] of deps)`

LS supports `for (const x of set)` via `SetToSeq`. Map iteration with
destructuring into key-value pairs is not supported.

**What to do:** Desugar to indexed loop over `map.Keys()` with `map[k]`
inside the body. Dafny has `m.Keys` (returns `set<K>`). Would need:
1. Extract recognizes `for (const [k, v] of map)` pattern
2. Transform desugars to `for (k of map.keys()) { let v = map.get(k); ... }`
3. Emit uses existing set iteration + map lookup

**Scope:** Large — new extraction pattern, transform rule, testing.

---

### B4. Optional chaining (`?.`) and null coalescing (`|| default`)

**Needed by:** #1 topologicalSort, #8 failure cascade

`workflow.ts` line 395: `adjacency.get(dep)?.push(nodeId)`
`workflow.ts` line 408: `adjacency.get(id) || []`
`workflow.ts` line 409: `(inDegree.get(neighbor) || 0) - 1`

**What to do:** Two patterns to recognize:

1. `expr?.method(args)` → desugar to `if expr !== undefined { expr.method(args) }`
   (match on Option, call in Some branch)

2. `expr || default` where `expr` is `T | undefined` → desugar to
   `match expr { Some(v) => v, None => default }`

These compose with the existing optional narrowing machinery (DESIGN_MAP_GET.md
Phase 5).

**Scope:** Medium-large — extends optional handling in extract + transform.

---

### B5. `Array.shift()` (dequeue from front)

**Needed by:** #1 topologicalSort

`workflow.ts` line 406: `const id = queue.shift()!;`

Array methods currently: `push`, `with`, `map`, `filter`, `every`, `some`,
`includes`, `find`. No `shift`/`unshift`/`pop`.

**What to do (Dafny):** `queue.shift()` → `queue[0]` + `queue := queue[1..]`.
The `!` non-null assertion can be dropped since the while condition guarantees
`queue.length > 0`.

**Scope:** Medium — method dispatch + statement rewrite (shift is both
expression and mutation).

---

### B6. `throw` / exception as verification failure

**Needed by:** #1 topologicalSort

`workflow.ts` line 417: `throw new Error('Workflow contains a cycle');`

**What to do:** Model `throw` as `assert false; // unreachable`. The
verification goal becomes: prove that the throw is unreachable under the
function's preconditions (i.e., the graph is acyclic).

Alternative: model as a post-condition `ensures \result.length === nodes.length`
and have the throw path violate it, so the verifier must prove it can't happen.

**Scope:** Small-medium — new statement kind in IR, simple emit.

---

## Tier C — Modeling/abstraction strategies (not LS fragment changes)

These features are intentionally outside the LS fragment. Candidates that use
them need the TS to be abstracted or rewritten before annotation.

### C1. Regex

**Affects:** #5 buildDependencyMap, #6 renderCitationLinks, #7 parseToolOutput,
#4 provenance (extractVerificationTokens)

**Strategy:** Model regex-dependent functions as spec-level uninterpreted
functions: `extractRefs(s): seq<string>`, `parseJSON(s): Option<Value>`.
Verify the logic *around* them, not the regex itself.

### C2. `JSON.parse` / `try-catch`

**Affects:** #7 parseToolOutput

**Strategy:** Same as C1 — model as `parseJSON(s): Option<Value>` at the
spec level. The fallback logic (try parse, try array extract, try object
extract) can be verified as a chain of option matches.

### C3. `unknown` type / `typeof` checks / type casts / dynamic property access

**Affects:** #2 resolvePath, #5 findTemplateRefs

**Strategy:** Model the nested value as a Dafny datatype:
```dafny
datatype Value = Str(s: string) | Num(n: int) | Arr(elems: seq<Value>)
              | Dict(fields: map<string, Value>) | Undef
```
Rewrite the function against this model type. This changes the TS
(or requires a parallel verification-only version).

### C4. `this` / class methods

**Affects:** #4 provenance (TaintKeyProvenanceTracker methods)

**Strategy:** Extract the pure logic from the method into a standalone
function that takes the relevant state as parameters. Annotate and verify
the standalone version.

### C5. Generator functions (`yield`)

**Affects:** #8 failure cascade

**Strategy:** Extract the cascade logic from the generator into a pure
function over the sorted node list + dependency map. Verify the pure version.

---

## Priority order for CharmChat verification

| Step | What | LS changes needed | Candidate unblocked |
|------|------|-------------------|---------------------|
| 1 | A1 + A2 | string truthiness, `.trim()` | #3 isEmptyResult |
| 2 | B1 + B2 + C3 | `.split()`, arr `.slice()`, Value ADT | #2 resolvePath |
| 3 | A3 + A4 + A5 + C4 | `.includes()`, `.toLowerCase()`, `Math.ceil` | #4 provenance threshold |
| 4 | B3-B6 + C1 | map iteration, `?.`, shift, throw | #1 topologicalSort |
| 5 | C1 + C2 | (modeling only) | #5, #6, #7 |
| 6 | C5 | (modeling only) | #8 failure cascade |

Step 1 is the immediate target. A1 and A2 are small, self-contained changes
to LemmaScript. Once done, `isEmptyResult` can be annotated and verified
without modifying the TypeScript.
