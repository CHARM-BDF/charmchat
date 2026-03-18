# ToolUniverse Integration

Curated wrapper MCP server that brings [ToolUniverse](https://github.com/mims-harvard/ToolUniverse) (2000+ biomedical tools from Harvard's Zitnik Lab) into charmgpt2 as a first-class tool provider.

## Why a wrapper instead of raw SMCP

ToolUniverse ships its own MCP server (`SMCP`), but plugging it in directly creates problems:

| Concern | Raw SMCP | Curated wrapper |
|---------|----------|-----------------|
| Tool count in LLM context | 2000+ tools → context bloat, poor selection | 16 tools → focused, reliable selection |
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
    ├── server.py                       FastMCP server, RateLimiter, lazy TU loader
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
- **Framework:** [FastMCP](https://gofastmcp.com) v3.1.1 — `@mcp.tool` decorators, auto JSON Schema from type hints
- **Environment:** managed by **uv** — no manual venv activation needed

ToolUniverse is **lazy-loaded on first tool call** (not at server startup) to avoid MCP connection timeouts. The server starts instantly, lists all 16 tools, and initializes TU only when a tool is actually invoked.

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

## Gotchas learned during integration

1. **Entry point collision:** The `tooluniverse` package registers `tooluniverse-mcp` as a console script. Our entry point must use a different name (`charm-tu-mcp`), otherwise `uv run` launches TU's raw SMCP server instead of ours.

2. **Startup timeout:** `tu.load_tools()` takes several seconds. If done at server startup, the backend's MCP client times out before the server can respond to `listTools()`. Fix: lazy-load TU on first tool call via a thread-safe singleton.

3. **Category names:** TU categories are **lowercase with spaces**, matching the JSON file stems in the package data directory (e.g., `uniprot_tools.json` → category `Uniprot`). They are NOT the casing used in tool names (e.g., `UniProt_get_entry_by_accession`).

4. **`.env` location:** The backend dev script does `cd backend && npm run dev`, so `dotenv/config` loads from `backend/.env`, not the project root. API keys (like `NCBI_API_KEY`) must be in `backend/.env`.

5. **Build backend:** `pyproject.toml` uses `hatchling.build` (not `hatchling.backends`).

## Tool categories

Category names for `load_tools()` (from `tu.list_built_in_tools(mode='config')`):

| Config category | Tool file | Tools |
|----------------|-----------|-------|
| `Uniprot` | `uniprot_tools.json` | 17 |
| `Alphafold` | `alphafold_tools.json` | varies |
| `Chembl` | `chembl_tools.json` | 29 |
| `Pubchem` | `pubchem_tools.json` | 18 |
| `Fda Drug Adverse Event` | `fda_drug_adverse_event_tools.json` | 15 |
| `Kegg` | `kegg_tools.json` | varies |
| `Reactome` | `reactome_tools.json` | varies |
| `Semantic Scholar` | `semantic_scholar_tools.json` | varies |
| `Clinvar` | `clinvar_tools.json` | varies |
| `Clinical Trials` | `clinical_trials_tools.json` | 16 |
| `Omim` | `omim_tools.json` | varies |
| `Tool Discovery Agents` | `tool_discovery_agents.json` | 7 |

Full catalog: 456 categories, 2099 tools. Run `tu.list_built_in_tools(mode='config')` to see all.

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

**Note:** The ToolUniverse tool names in the table above are best-effort based on the package's naming conventions. If a tool call fails, check the actual names with:

```python
uv run python -c "
from tooluniverse import ToolUniverse
tu = ToolUniverse()
names = tu.list_built_in_tools(mode='list_name')
for n in sorted(names):
    if 'UniProt' in n or 'uniprot' in n.lower():
        print(n)
"
```

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

### Lazy loading (`server.py`)

ToolUniverse is loaded on first tool call via a thread-safe singleton to avoid MCP connection timeouts:

```python
def _lazy_tu():
    tu = None
    lock = threading.Lock()

    def get():
        nonlocal tu
        if tu is None:
            with lock:
                if tu is None:
                    from tooluniverse import ToolUniverse
                    tu = ToolUniverse()
                    tu.load_tools(categories=CATEGORIES, quiet=True)
        return tu

    return get
```

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
        return get_tu().run({"name": tool_name, "arguments": arguments})
    except Exception as e:
        logger.error("%s failed: %s", tool_name, e)
        raise ToolError(str(e))        # FastMCP converts to isError response
```

`ToolError` from FastMCP sets `isError: true` on the MCP response, matching the convention used by every other server in the project.

### Rate limiting

Thread-safe `RateLimiter` class enforces per-service courtesy delays, matching existing patterns (pubmed-mcp 100ms with API key, variant-domain-mcp 1000ms):

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

`find-tools` lets the LLM search ToolUniverse's full 2000+ tool catalog by keyword. Discovery only — returns tool info, doesn't invoke. Frequent discoveries signal which tools to promote to Phase 2.

## Configuration

### mcp-servers.json

```json
"tooluniverse": {
  "command": "uv",
  "args": ["run", "--directory", "../mcp-servers/tooluniverse-mcp", "charm-tu-mcp"]
}
```

`uv run` auto-syncs the venv and runs the `charm-tu-mcp` entry point. No Python path management needed.

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

Installed versions: `fastmcp==3.1.1`, `tooluniverse==1.1.4` (191 packages total).

## Testing

1. **Unit tests** — mock `tu.run()`, verify formatters produce valid markdown
2. **Integration test** — `uv run charm-tu-mcp` and call tools via MCP protocol
3. **Smoke test** — ask the LLM "what protein does P05067 encode?" and verify it calls `tooluniverse__get-protein-entry`

No changes to existing tests. The wrapper is additive.

## By the numbers

| Metric | Value |
|--------|-------|
| New files | 13 |
| Lines of Python | ~400 |
| New dependencies | 2 (`fastmcp`, `tooluniverse`) + 189 transitive |
| Tools exposed (Phase 1) | 16 |
| Tools exposed (Phase 2) | up to ~25 |
| Existing files modified | 3 (`mcp-servers.json`, `.env.example`, `.gitignore`) |
| Existing servers affected | 0 |
