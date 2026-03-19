# ToolUniverse Integration

Curated wrapper MCP server that brings [ToolUniverse](https://github.com/mims-harvard/ToolUniverse) (2000+ biomedical tools from Harvard's Zitnik Lab) into charmgpt2 as a first-class tool provider.

## Why a wrapper instead of raw SMCP

ToolUniverse ships its own MCP server (`SMCP`), but plugging it in directly creates problems:

| Concern | Raw SMCP | Curated wrapper |
|---------|----------|-----------------|
| Tool count in LLM context | 2000+ tools → context bloat, poor selection | ~23 tools → focused, reliable selection |
| Overlap with existing servers | Duplicate pubmed, variant, entity tools | Explicitly complementary; overlap documented |
| Workflow compatibility | Opaque `call_tool` proxy breaks DAG replay | Stable, named tools work with `{{step.field}}` references |
| Rate limiting | Blanket concurrency, no per-tool awareness | Per-service courtesy delays matching existing server patterns |
| API key management | ToolUniverse's own config system | Unified `.env` alongside existing keys |

## Architecture

```
mcp-servers/tooluniverse-mcp/
├── pyproject.toml                      Dependencies (mcp, tooluniverse)
├── scripts/
│   └── list_tools.py                   Regenerate TOOLUNIVERSE_TOOLS.md
└── src/tooluniverse_mcp/
    ├── __init__.py
    ├── __main__.py                     python -m entry point
    ├── server.py                       MCP server, lazy TU loader, rate limiter
    ├── config.py                       Curated tool list + rate limits
    └── formatting.py                   Result → markdown/table adapters
```

- **Transport:** stdio (same as every other MCP server in the project)
- **Language:** Python (ToolUniverse is a Python package)
- **MCP SDK:** low-level `mcp` Python SDK (tool specs come from TU directly, no need for FastMCP decorators)
- **Environment:** managed by **uv** — no manual venv activation needed

Tool specs are read from TU's built-in catalog at startup (fast JSON reads). The full ToolUniverse runtime is **lazy-loaded on first tool call** to avoid MCP connection timeouts. The server starts instantly, lists tools from specs, and initializes TU only when a tool is actually invoked.

## Setup

```bash
# One-time install (creates .venv automatically)
cd mcp-servers/tooluniverse-mcp
uv sync

# The backend starts it automatically via mcp-servers.json.
# To test manually:
uv run charm-tu-mcp
```

No conda environment, no manual activation. `uv run` resolves the local `.venv` automatically.

**Note:** The entry point is `charm-tu-mcp`, not `tooluniverse-mcp`. The `tooluniverse` pip package registers its own `tooluniverse-mcp` console script (which launches the raw SMCP server), so we use a different name to avoid the collision.

## Changing the exposed tools

Edit `CURATED_TOOLS` in `config.py`:

```python
# config.py

# Tools to expose via MCP. Set to None to expose ALL 2000+ tools.
CURATED_TOOLS: set[str] | None = {
    "UniProt_get_entry_by_accession",
    "ChEMBL_search_molecules",
    "OMIM_search",
    # ... add any tool name from TOOLUNIVERSE_TOOLS.md
}
```

- **Add a tool:** add its exact name (from `TOOLUNIVERSE_TOOLS.md`) to the set
- **Remove a tool:** delete the line
- **Expose everything:** set `CURATED_TOOLS = None`
- **Regenerate the catalog:** `cd mcp-servers/tooluniverse-mcp && uv run python scripts/list_tools.py > ../../TOOLUNIVERSE_TOOLS.md`

Tool names, descriptions, and input schemas all come from ToolUniverse automatically — no manual tool definitions needed. The server reads TU's `list_built_in_tools(mode='list_spec')` at startup.

## How it works

### Startup (fast)

1. `_load_specs()` calls `tu.list_built_in_tools(mode='list_spec')` — reads JSON files, no heavy init
2. Filters specs to `CURATED_TOOLS` set (or keeps all if `None`)
3. MCP server starts, responds to `listTools` with specs immediately

### First tool call (slow, one-time)

1. `_get_tu()` creates a `ToolUniverse()` instance and calls `load_tools(quiet=True)` — loads all 2000 tools
2. Subsequent calls reuse the cached instance (thread-safe singleton)

### Every tool call

1. Rate limiter applies courtesy delay based on tool name prefix
2. `tu.run({"name": tool_name, "arguments": args})` executes the tool
3. `format_result()` converts the response to readable markdown
4. Result returned as MCP `TextContent`

### Rate limiting

Per-service courtesy delays, keyed by tool name prefix:

```python
RATE_LIMITS = {
    "UniProt": 0.5,  "alphafold": 0.5,  "ChEMBL": 0.5,
    "PubChem": 0.5,  "kegg": 1.0,       "Reactome": 0.5,
    "SemanticScholar": 0.5,  "clinvar": 0.35,
    "search_clinical": 0.5,  "OMIM": 0.5,
}
```

### Result formatting

`format_result()` in `formatting.py` converts TU's raw returns to readable markdown:

- **Dict** → bold-labeled key-value pairs
- **List of dicts** → markdown table (capped at 50 rows, 8 columns)
- **List** → bullet list
- **String** → pass-through
- **None** → "No results returned."

## Overlap with existing servers

| Existing server | Plan |
|-----------------|------|
| pubmed-mcp | **Keep.** Custom rate limiting and bibliography artifacts. TU's Semantic Scholar covers the literature gap instead. |
| medik-mcp | **Keep.** MediKanren's 2-hop path queries are unique. |
| id-finder-mcp | **Keep.** Entity normalization is a cross-cutting utility. |
| variant-domain-mcp | **Keep.** Domain mapping is unique. TU adds ClinVar clinical significance (complementary). |

No existing server is replaced.

## Gotchas learned during integration

1. **Entry point collision:** The `tooluniverse` package registers `tooluniverse-mcp` as a console script. Our entry point must use a different name (`charm-tu-mcp`).

2. **Startup timeout:** `tu.load_tools()` takes several seconds. Fix: load only specs at startup (fast), lazy-load runtime on first tool call.

3. **Category filtering broken:** `tu.load_tools(categories=[...])` silently loads 0 tools — category names don't match internal lookup. Fix: load all tools with `tu.load_tools(quiet=True)`, curate at the MCP layer instead.

4. **`.env` location:** The backend dev script does `cd backend && npm run dev`, so `dotenv/config` loads from `backend/.env`, not the project root.

5. **Build backend:** `pyproject.toml` uses `hatchling.build` (not `hatchling.backends`).

## Configuration

### mcp-servers.json

```json
"tooluniverse": {
  "command": "uv",
  "args": ["run", "--directory", "../mcp-servers/tooluniverse-mcp", "charm-tu-mcp"]
}
```

### Environment variables

In `backend/.env`:

```bash
# ToolUniverse (optional — most tools work without keys, but with rate limits)
SEMANTIC_SCHOLAR_API_KEY=
FDA_API_KEY=
# NCBI_API_KEY already shared with pubmed-mcp
```

### Dependencies

```toml
dependencies = ["mcp>=1.0.0", "tooluniverse>=0.1.0"]
```

Installed: `tooluniverse==1.1.4`, `mcp==1.26.0` (191 packages total).
