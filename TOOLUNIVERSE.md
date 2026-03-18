# ToolUniverse Integration

Curated wrapper MCP server that brings [ToolUniverse](https://github.com/mims-harvard/ToolUniverse) (600+ biomedical tools from Harvard's Zitnik Lab) into charmgpt2 as a first-class tool provider.

## Why a wrapper instead of raw SMCP

ToolUniverse ships its own MCP server (`SMCP`), but plugging it in directly creates problems:

| Concern | Raw SMCP | Curated wrapper |
|---------|----------|-----------------|
| Tool count in LLM context | 600+ tools → context bloat, poor selection | 16 tools → focused, reliable selection |
| Overlap with existing servers | Duplicate pubmed, variant, entity tools | Explicitly complementary; overlap documented |
| Output formatting | Generic text blobs | Shaped for charmgpt2 artifacts (images, markdown, structured data) |
| Workflow compatibility | Opaque `call_tool` proxy breaks DAG replay | Stable, named tools work with `{{step.field}}` references |
| Rate limiting | Blanket concurrency, no per-tool awareness | Per-service courtesy delays matching existing server patterns |
| API key management | ToolUniverse's own config system | Unified `.env` alongside existing keys |

## Architecture

```
mcp-servers/tooluniverse-mcp/
├── pyproject.toml                      Dependencies (fastmcp, tooluniverse)
└── src/tooluniverse_mcp/
    ├── __init__.py
    ├── __main__.py                     python -m entry point
    ├── server.py                       FastMCP server, RateLimiter, call() wrapper
    ├── config.py                       Categories, rate limits, env overrides
    ├── formatting.py                   Result → markdown/table adapters
    └── tools/
        ├── protein.py                  UniProt, AlphaFold (4 tools)
        ├── compound.py                 ChEMBL, PubChem, FDA (4 tools)
        ├── pathway.py                  KEGG, Reactome (2 tools)
        ├── literature.py               Semantic Scholar (2 tools)
        ├── clinical.py                 ClinVar, ClinicalTrials, OMIM (3 tools)
        └── discovery.py                Tool_Finder_Keyword (1 tool)
```

- **Transport:** stdio (same as every other MCP server in the project)
- **Language:** Python (ToolUniverse is a Python package)
- **Framework:** [FastMCP](https://gofastmcp.com) — `@mcp.tool` decorators, auto JSON Schema from type hints
- **Environment:** managed by **uv** — no manual venv activation needed

The server imports `tooluniverse` at startup, calls `load_tools()` with a category allowlist, then exposes each curated tool as a proper MCP tool with its own name and schema. No generic `call_tool` proxy.

## Setup

```bash
# One-time install (creates .venv automatically)
cd mcp-servers/tooluniverse-mcp
uv sync

# The backend starts it automatically via mcp-servers.json.
# To test manually:
uv run tooluniverse-mcp
```

No conda environment, no manual activation. `uv run` resolves the local `.venv` automatically.

## Curated tool set

### Phase 1 — 16 tools (implemented)

| Group | MCP tool name | ToolUniverse name | What it does |
|-------|---------------|-------------------|--------------|
| **Protein** | `get-protein-entry` | `UniProt_get_entry_by_accession` | Full UniProt record by accession |
| | `get-protein-function` | `UniProt_get_function_by_accession` | Functional annotations |
| | `get-protein-expression` | `UniProt_get_expression_by_accession` | Tissue expression patterns |
| | `get-protein-structure` | `AlphaFold_get_prediction` | AlphaFold2 predicted structure |
| **Compound** | `search-compounds` | `ChEMBL_compound_search` | Chemical compound lookup |
| | `get-compound-activity` | `ChEMBL_compound_activity` | Bioactivity data for a compound |
| | `get-drug-safety` | `FDA_drug_safety_query` | FDA adverse event reports |
| | `get-compound-properties` | `PubChem_get_compound` | Chemical properties by CID or name |
| **Pathway** | `get-pathway` | `KEGG_get_pathway` | KEGG pathway details and gene list |
| | `pathway-enrichment` | `Reactome_pathway_enrichment` | Enrichment analysis for gene set |
| **Literature** | `search-papers` | `SemanticScholar_search` | Citation-aware paper search |
| | `get-paper-details` | `SemanticScholar_paper_details` | Full metadata, references, citations |
| **Clinical** | `get-variant-significance` | `ClinVar_get_variant` | Clinical significance of variant |
| | `search-clinical-trials` | `ClinicalTrials_search` | Active clinical trials by condition/drug |
| | `get-disease-info` | `OMIM_get_disease` | Genetic disease entry |
| **Discovery** | `find-tools` | `Tool_Finder_Keyword` | Search ToolUniverse catalog by keyword |

In the chat UI, tools appear as `tooluniverse__get-protein-entry`, `tooluniverse__search-compounds`, etc. (the backend prefixes the server name automatically).

### Phase 2 — expansion candidates

Add when users demonstrate need:

- `DRUGBANK_get_drug` — drug–drug interaction data
- `DisGeNET_gene_disease` — gene–disease associations
- `Ensembl_get_gene` — genome browser data
- `PDB_get_structure` — experimental protein structures
- `PRIDE_search` — proteomics datasets
- `ArXiv_search` / `BioRxiv_search` — preprint search

### Overlap with existing servers

| Existing server | Overlapping ToolUniverse tools | Plan |
|-----------------|-------------------------------|------|
| pubmed-mcp | `PubMed_search`, `PubMed_get_abstract` | **Keep pubmed-mcp.** It has custom rate limiting and bibliography artifacts. TU's Semantic Scholar covers the literature gap instead. |
| medik-mcp | `DisGeNET_*`, various KG tools | **Keep medik-mcp.** MediKanren's 2-hop path queries are unique. Only add non-overlapping TU tools (DisGeNET in Phase 2). |
| id-finder-mcp | `SRI_Normalizer` | **Keep id-finder-mcp.** Entity normalization is a cross-cutting utility, not a TU tool. |
| variant-domain-mcp | `ClinVar_*`, `Ensembl_*` | **Keep variant-domain-mcp** for domain mapping. TU adds ClinVar clinical significance (complementary, not duplicate). |

No existing server is replaced. The wrapper strictly adds capabilities that don't exist today.

## Implementation details

### How tools are registered

Each tool module exports a `register(mcp, call)` function. `mcp` is the FastMCP instance; `call` is a wrapper around `tu.run()` that handles rate limiting and errors:

```python
# tools/protein.py
def register(mcp, call):

    @mcp.tool(name="get-protein-entry")
    def get_protein_entry(
        accession: Annotated[str, "UniProt accession (e.g. P05067, Q9Y6K9)"],
    ) -> str:
        """Get full UniProt protein record: function, structure, GO terms, cross-references."""
        result = call("UniProt_get_entry_by_accession", {"accession": accession}, service="UniProt")
        return format_result(result)
```

FastMCP auto-generates JSON Schema from the type annotations and docstring. The `call()` closure captures the ToolUniverse instance and rate limiter — tool modules never import them directly.

### The `call()` wrapper (`server.py`)

```python
def call(tool_name: str, arguments: dict, service: str | None = None):
    if service:
        limiter.wait(service)          # courtesy delay
    try:
        return tu.run({"name": tool_name, "arguments": arguments})
    except Exception as e:
        logger.error("%s failed: %s", tool_name, e)
        raise ToolError(str(e))        # FastMCP converts to isError response
```

`ToolError` from FastMCP sets `isError: true` on the MCP response, matching the convention used by every other server in the project.

### Rate limiting

Thread-safe `RateLimiter` class enforces per-service courtesy delays, matching existing patterns (pubmed-mcp 350ms, variant-domain-mcp 1000ms):

```python
RATE_LIMITS = {
    "UniProt": 0.5,    "ChEMBL": 0.5,    "PubChem": 0.5,
    "AlphaFold": 0.5,  "REACTOME": 0.5,   "Semantic_Scholar": 0.5,
    "KEGG": 1.0,       "FDA": 1.0,        "Clinical_Trials": 0.5,
    "ClinVar": 0.35,   "OMIM": 0.5,
}
```

### Result formatting

`format_result()` in `formatting.py` converts TU's raw returns to readable markdown:

- **Dict** → bold-labeled key-value pairs
- **List of dicts** → markdown table (capped at 50 rows, 8 columns)
- **List** → bullet list
- **String** → pass-through
- **None** → "No results returned."

Custom formatters per tool can be added later when we know the exact return shapes.

### Discovery meta-tool

`find-tools` lets the LLM search ToolUniverse's full 600+ tool catalog by keyword. Discovery only — returns tool info, doesn't invoke. Frequent discoveries signal which tools to promote to Phase 2.

## Configuration

### mcp-servers.json

```json
"tooluniverse": {
  "command": "uv",
  "args": ["run", "--directory", "../mcp-servers/tooluniverse-mcp", "tooluniverse-mcp"]
}
```

`uv run` auto-syncs the venv and runs the `tooluniverse-mcp` entry point. No Python path management needed.

### Environment variables

Added to `.env.example`:

```bash
# ToolUniverse (optional — most tools work without keys, but with rate limits)
SEMANTIC_SCHOLAR_API_KEY=       # higher rate limits for paper search
FDA_API_KEY=                    # higher rate limits for drug safety queries
# NCBI_API_KEY already shared with pubmed-mcp
```

Override loaded categories via `TU_CATEGORIES` env var (comma-separated).

### Dependencies

```toml
# pyproject.toml
dependencies = [
    "fastmcp>=2.0.0",
    "tooluniverse>=0.1.0",
]
```

## Testing

1. **Unit tests** — mock `tu.run()`, verify formatters produce valid markdown
2. **Integration test** — `uv run tooluniverse-mcp` and call tools via MCP protocol
3. **Smoke test** — ask the LLM "what protein does P05067 encode?" and verify it calls `tooluniverse__get-protein-entry`

No changes to existing tests. The wrapper is additive.

## Caveats

- **ToolUniverse tool names and parameter schemas** are based on documentation research. Some names may differ from the actual TU package — run `tu.list_built_in_tools(mode='list_name')` after install to verify, and adjust the tool modules accordingly.
- **Category names** (`UniProt`, `ChEMBL`, etc.) need verification against `tu.list_built_in_tools(mode='config')`.
- **Return formats** vary by tool. The generic `format_result()` handles common cases; specific tools may need custom formatters once we see actual output shapes.

## By the numbers

| Metric | Value |
|--------|-------|
| New files | 12 |
| Lines of Python | ~350 |
| New dependencies | 2 (`fastmcp`, `tooluniverse`) |
| Tools exposed (Phase 1) | 16 |
| Tools exposed (Phase 2) | up to ~25 |
| Existing files modified | 2 (`mcp-servers.json`, `.env.example`) |
| Existing servers affected | 0 |
