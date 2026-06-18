# charmchat — Verified with LemmaScript

[![LemmaScript verified](https://img.shields.io/github/actions/workflow/status/CHARM-BDF/charmchat/verify.yml?branch=lemma&label=LemmaScript%20verified)](https://github.com/CHARM-BDF/charmchat/actions/workflows/verify.yml)

This is a fork of [CHARM-BDF/charmchat](https://github.com/CHARM-BDF/charmchat) with formal verification of workflow orchestration logic using [LemmaScript](https://github.com/midspiral/LemmaScript) (Dafny backend). [View as diff](https://github.com/CHARM-BDF/charmchat/compare/main...lemma).

LemmaScript annotates TypeScript directly with `//@ ` specifications and generates Dafny for verification. 23 helper lemmas, 14 opaque ghost predicates, 115 loop invariants; **736 VCs verified, 0 errors** under `--isolate-assertions --verification-time-limit 600`.

## What's Verified

### `isEmptyResult` (`backend/src/services/provenance.ts`)

Predicate used by the provenance pipeline to skip trivial/empty tool outputs before claim verification. 8 postconditions enumerate the accepted empty forms — empty string, whitespace-only, `{}`, `[]`, `null`, `undefined`, `{"content":[]}`, `{"results":[]}`. Verifies in under a second.

### `topologicalSort` (`backend/src/services/workflow.ts`) — Kahn's algorithm

The workflow executor uses topological sort to linearize an acyclic DAG of tool calls. We verify:

- **Memory safety and termination** — every map/array access is in-bounds; `decreases` clauses guarantee all three phases terminate.
- **Output bound**: `|res| <= |nodes|` — the result is a subset of the input in the sequence sense.
- **Completeness**: `|res| == |nodes|` — every node appears in the output. Combined with the bound, this means the returned sequence is a permutation of `nodes`.

Completeness is the hard part. The method takes an `exists rank: map<string, nat> :: IsRanking(...)` witness of acyclicity, so if completeness fails the method's `assert false` in the cycle-check branch is unreachable — the caller contract says "if you promise the graph is acyclic, you always get a full ordering back."

The proof reasons about a subtle three-phase algorithm with mid-iteration invariants (remDeps is updated neighbor-by-neighbor; `processed` only advances at the end of each outer iteration). The key bookkeeping is:

- `remDeps: map<string, set<string>>` — ghost state tracking "dependencies not yet discharged." Starts equal to `deps`, shrinks as nodes are popped.
- `seenIdNeighbors: set<string>` — mid-inner-iteration tracker of which neighbors of the current `id` have been processed.
- `originalRemDeps` — ghost snapshot captured at the start of each outer body; see below.

## Key technique: snapshot-based inner invariants

The hardest timeouts involved preserving the mid-iteration split

```dafny
// for each neighbor v of id:
//   remDeps[v] == deps[v] - processed           // if v !in seenIdNeighbors
//   remDeps[v] == deps[v] - processed - {id}    // if v in seenIdNeighbors
```

across the inner-loop body. These were timing out under `--isolate-assertions` even with preservation lemmas providing the post-state facts — apparently the invariant-preservation VCs regenerate without the intermediate-assert context.

The fix is structural: capture `ghost var originalRemDeps := remDeps;` at outer-body start, and rewrite the inner invariants against this ghost constant instead of `deps - processed`:

```dafny
invariant remDeps.Keys == originalRemDeps.Keys
invariant forall v :: v in remDeps && v !in seenIdNeighbors ==> remDeps[v] == originalRemDeps[v]
invariant forall v :: v in remDeps && v in seenIdNeighbors ==> remDeps[v] == originalRemDeps[v] - {id}
invariant RemDepsTracksProcessed(originalRemDeps, deps, processed)  // trivially preserved
```

Preservation becomes pure frame reasoning — `remDeps[v]` only changes when `v == neighbor`, and neighbor moves from unseen to seen with the expected `{id}` subtraction. No set-subtraction arithmetic for Z3 to chew on mid-iteration.

The old `UnseenInv` / `SeenInv` predicates remain defined but become *derived* facts, established at the post-inner point via a single lemma (`UnseenSeenFromSnap`) that feeds into `RemDepsTracksProcessedAfterId` to re-establish the outer `RemDepsTracksProcessed(remDeps, deps, processed + {id})` invariant.

## Setup

**Prerequisites:** [Dafny](https://github.com/dafny-lang/dafny) ≥ 4.0, Node.js ≥ 18.

```sh
git clone https://github.com/midspiral/LemmaScript.git ../LemmaScript
cd ../LemmaScript && npm install
```

## Verify

```sh
../LemmaScript/tools/check.sh dafny-slow
```

Per-file config in `LemmaScript-files.txt`:

```
backend/src/services/provenance.ts
backend/src/services/workflow.ts 600 --isolate-assertions
```

`workflow.ts` needs `--isolate-assertions` (the whole-method VC otherwise doesn't converge even at 900s) and a 600s per-assertion budget to accommodate the heavy lemma/opaque-predicate axiomatization.

## File Structure

```
backend/src/services/
  provenance.ts      ← isEmptyResult with //@ annotations
  provenance.dfy     ← Generated + verified (8 postconditions)
  provenance.dfy.gen ← Fresh-generated form (diff invariant: .dfy must be superset)

  workflow.ts        ← topologicalSort with //@ annotations
  workflow.dfy       ← Generated + manual proof scaffolding (23 lemmas, 14 opaque predicates, 115 invariants)
  workflow.dfy.gen   ← Fresh-generated form
```

The `.dfy.gen` is regeneratable at any time via `lsc gen`. The `.dfy` is the verification target; it starts as a copy of `.gen` but accumulates manual proof additions. LemmaScript enforces that `.dfy` is an **additions-only superset** of `.gen` (no line from the generated output may be deleted), so the TypeScript remains the source of truth for the algorithm and the manual additions are purely proof infrastructure.

## How It Works

1. Add `//@ ` annotations to TypeScript:

   ```typescript
   export function topologicalSort(
     nodes: WorkflowNode[],
     deps: Map<string, Set<string>>
   ): WorkflowNode[] {
     //@ verify
     //@ ensures \result.length <= nodes.length
     ...
   }
   ```

2. Generate and verify:

   ```sh
   npx tsx ../LemmaScript/tools/src/lsc.ts check --backend=dafny \
     --time-limit=600 --extra-flags=--isolate-assertions \
     backend/src/services/workflow.ts
   ```

3. Manual proof additions (opaque predicates, lemmas, extra invariants, ghost snapshots) live in `workflow.dfy` directly — they strengthen what's provable without changing the TypeScript. A gen-diff guard in `lsc check` refuses to proceed if any generated line has been modified or removed.

## Case study takeaways

- **Opaque predicates** (`ghost predicate {:opaque} …`) are essential for managing Z3's quantifier-instantiation cost under `--isolate-assertions`. Nested `forall` invariants become uninterpreted facts in unrelated VCs; reveal only at specific proof sites via `assert X by { reveal P(); }`.
- **Preservation lemmas** move hard proofs into single-VC named lemmas whose `ensures` propagate as opaque facts. Lemma ensures flow through loop-invariant preservation VCs; in-body `assert` facts often don't (apparent `--isolate-assertions` quirk).
- **The snapshot pattern**: when an invariant is defined against mutable state (`remDeps[v] == deps[v] - processed`), preservation asks Z3 to reason about set arithmetic mid-mutation. Rewriting against a ghost-constant snapshot (`remDeps[v] == originalRemDeps[v]`) turns it into frame reasoning — dramatically easier.
- **Don't trust "logically redundant"**: removing invariants that are implied by others made timeouts worse. They were acting as hints Z3 uses to avoid re-derivation.
- **Try doubling the time budget** before redesigning. At 300s per VC we had 2 stubborn timeouts; at 600s the file verifies cleanly.
