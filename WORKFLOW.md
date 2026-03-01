# Workflow DAG + Provenance

Reusable, parameterized tool-call pipelines with deterministic replay and full provenance tracking.

## Overview

During normal chat, CharmGPT records every MCP tool call as a **trace**. A trace can be extracted into a **workflow** — a parameterized DAG of tool calls connected by `$ref` links. Workflows replay deterministically without any LLM involvement: arguments are resolved mechanically from previous step outputs, and every execution is saved with full provenance (resolved args, arg sources, outputs, timing, status).

## Concepts

| Term | Description |
|------|-------------|
| **Tool Trace** | Timestamped record of each MCP tool call during chat (tool, args, result, duration) |
| **Workflow** | Parameterized DAG template — nodes are tool calls, edges are `$ref` dependencies |
| **$ref** | Dependency link: `{ "$ref": "step1.curie" }` resolves to step1's output `.curie` field |
| **Workflow Execution** | Recorded replay with full provenance per node |

## How `$ref` Works

### Object-level (tool arguments)
When a tool argument depends on a previous step's output:
```json
{
  "id": "step2",
  "tool": "medik__get-everything",
  "args": {
    "entity": { "$ref": "step1.curie" }
  }
}
```
At runtime, `step1`'s output is parsed and the `.curie` field is extracted and substituted.

### User input
```json
{ "$ref": "$input.geneName" }
```
Resolves to the parameter the user provides when running the workflow.

### String interpolation (for code arguments)
When `$ref` appears inside a string value (e.g. Python code), it's replaced inline:
```json
{
  "id": "step3",
  "tool": "python__execute_python",
  "args": {
    "code": "import json\ndata = json.loads('''{ \"$ref\": \"step2\" }''')\nprint(len(data))"
  }
}
```
At runtime, the `{ "$ref": "step2" }` substring is replaced with the stringified output of step2.

## Architecture

### Data Flow

```
Chat → trace_entry SSE events → toolTrace on Conversation
                                        ↓
                              "Save as Workflow" button
                                        ↓
                          LLM analyzes trace → Workflow JSON
                                        ↓
                              Workflow Runner UI
                                        ↓
                          Mechanical $ref execution (no LLM)
                                        ↓
                              WorkflowExecution (provenance)
```

### Execution Engine (`backend/src/services/workflow.ts`)

1. **Dependency scan** — `buildDependencyMap()` walks all node args (including strings) to find `$ref` patterns and build a dependency graph
2. **Topological sort** — Kahn's algorithm determines execution order
3. **Sequential execution** — each node runs in order:
   - `resolveRefs()` substitutes all `$ref` patterns from previous outputs
   - Unresolved refs → node fails immediately
   - `mcpService.callTool()` executes the tool
   - `parseToolOutput()` extracts JSON from mixed text+JSON results (single-element arrays are unwrapped)
   - Error detection: checks `isError` flag + text patterns (`error:`, `execution failed:`)
4. **Cascading failure** — if a node fails, all downstream dependents are skipped
5. **Provenance** — `WorkflowExecution` saved with `resolvedArgs`, `argSources`, `output`, `durationMs`, `status` per node

### Key Helper Functions

| Function | Purpose |
|----------|---------|
| `findRefs(obj, validIds, deps)` | Recursively finds `$ref` dependencies in both objects and strings |
| `resolveRefs(args, outputs)` | Deep-clones args, replaces `$ref` with values, returns resolved args + source map + unresolved list |
| `parseToolOutput(resultStr)` | Extracts JSON from mixed text+JSON output; unwraps single-element arrays |
| `topologicalSort(nodes, deps)` | Kahn's algorithm for execution ordering |
| `extractJSON(text)` | Extracts JSON from LLM responses (handles ```json fences) |

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workflows` | List all workflows (WorkflowMeta[]) |
| GET | `/api/workflows/:id` | Get full workflow definition |
| POST | `/api/workflows/extract` | Extract workflow from conversation trace (LLM-assisted) |
| PUT | `/api/workflows/:id` | Update workflow |
| DELETE | `/api/workflows/:id` | Delete workflow |
| POST | `/api/workflows/:id/execute` | Execute workflow (SSE stream) |
| GET | `/api/executions/:id` | Get execution with full provenance |

### SSE Events (during execution)

| Event | Data | Description |
|-------|------|-------------|
| `tool_call` | `{ id, name, arguments }` | Node is about to execute |
| `tool_result` | `{ toolCallId, name, result, isError?, durationMs }` | Node completed or failed |
| `trace_entry` | `{ id, tool, args, result, timestamp, durationMs }` | Trace record (success only) |
| `done` | `{ executionId, status }` | Execution finished |
| `error` | `{ error }` | Fatal error |

## Data Storage

All data is JSON files on disk:

```
data/
  workflows/      # Workflow definitions (*.json)
  executions/      # Execution provenance records (*.json)
  conversations/   # Conversations with toolTrace field
```

## Files Changed (from `main`)

### New Files
| File | Lines | Description |
|------|-------|-------------|
| `backend/src/services/workflow.ts` | 571 | Workflow extraction (LLM) + execution engine (mechanical) |
| `backend/src/routes/workflows.ts` | 132 | REST API routes for workflows and executions |
| `frontend/src/stores/workflowStore.ts` | 162 | Zustand store — fetch, select, execute, delete workflows |
| `frontend/src/components/workflow/WorkflowRunner.tsx` | 444 | Parameter form, live step progress, results display |
| `frontend/src/components/workflow/TraceView.tsx` | 70 | Mermaid DAG visualization from traces/executions |

### Modified Files
| File | Description |
|------|-------------|
| `backend/src/types/index.ts` | Added ToolTraceEntry, Workflow, WorkflowMeta, NodeExecution, WorkflowExecution types; `trace_entry` SSE event; `toolTrace` on Conversation |
| `frontend/src/types/index.ts` | Mirrors backend types + WorkflowStepStatus for live UI tracking |
| `backend/src/services/chat.ts` | Yields `trace_entry` SSE event after each tool call (+13 lines) |
| `backend/src/services/storage.ts` | CRUD for workflows and executions (+92 lines) |
| `backend/src/index.ts` | Registers WorkflowService + routes (+5 lines) |
| `frontend/src/stores/chatStore.ts` | Accumulates toolTrace from SSE, persists/restores it (+17 lines) |
| `frontend/src/App.tsx` | Renders WorkflowRunner when workflow selected (+9 lines) |
| `frontend/src/components/chat/ChatPanel.tsx` | "Save as Workflow" button (+53 lines) |
| `frontend/src/components/layout/Sidebar.tsx` | Collapsible workflows section with select/delete (+67 lines) |
| `mcp-servers/python-mcp/src/execute.ts` | Fixed `ensureDockerImage()` to use `docker images -q` instead of `docker image inspect` (Docker Desktop bug workaround) |

## User Flow

1. **Chat normally** — tool calls are recorded as trace entries automatically
2. **Save as Workflow** — click button in top bar → LLM extracts a parameterized workflow from the trace
3. **Select workflow** — click in sidebar → WorkflowRunner shows parameter form
4. **Run** — fill in parameters, click Run → steps execute in sequence with live progress
5. **Review results** — expandable step cards show args, results, errors, timing; pipeline summary at the end
6. **Provenance** — full execution record saved in `data/executions/` with resolved args, arg sources, and outputs per node

## Known Limitations

- Execution is sequential (no parallel node execution even when the DAG allows it)
- Workflow extraction depends on LLM quality — may need manual editing of the saved workflow JSON for complex traces
- `parseToolOutput` uses heuristic JSON extraction from mixed text — can fail on unusual output formats
- No workflow versioning or edit UI — workflows are edited by modifying the JSON file directly
