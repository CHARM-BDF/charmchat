# Artifact System

## Architecture

The artifact system uses a **registry pattern** — each viewer is a self-contained component that registers itself by type string. Adding a new artifact type = adding one file in `viewers/` and one line in `registry.ts`.

### Key design decisions

- **Open type system** — Artifact `type` is a `string`, not a closed union. MCP servers can emit any type; unknown types fall back to preformatted text.
- **Lazy loading** — Viewers are loaded on demand via `React.lazy()`. Heavy viewers (reagraph for knowledge graphs) don't affect startup.
- **Viewer interface** — Every viewer gets `{ content: string; title: string; language?: string }`.
- **MCP artifact forwarding** — The backend forwards artifacts from MCP tool results (not just from LLM text parsing).

### File structure

```
frontend/src/components/artifacts/
  ArtifactPanel.tsx          # Shell: tabs, controls, delegates to registry
  registry.ts                # Map<type, lazy(() => import('./viewers/...'))>
  CodeBlock.tsx              # Shared code rendering component
  MarkdownView.tsx           # Shared markdown rendering component
  MermaidDiagram.tsx         # Shared mermaid rendering component (pan/zoom)
  viewers/
    CodeView.tsx             # Wraps CodeBlock
    MarkdownView.tsx         # Wraps MarkdownView
    MermaidView.tsx          # Wraps MermaidDiagram
    HtmlView.tsx             # dangerouslySetInnerHTML
    ImageView.tsx            # <img> with error handling
    FallbackView.tsx         # Preformatted text for unknown types
    JsonView.tsx             # Formatted/raw toggle with syntax highlighting
    BibliographyView.tsx     # Citation list with PMID links
    KnowledgeGraphView.tsx   # Reagraph interactive graph + list toggle
```

### Registry type mapping

The registry maps both short names and MIME-style types for compatibility with different MCP servers:

| Type string | Viewer |
|---|---|
| `code` | CodeView |
| `markdown`, `text/markdown` | MarkdownView |
| `mermaid` | MermaidView |
| `html` | HtmlView |
| `image` | ImageView |
| `json` | JsonView |
| `bibliography`, `application/vnd.bibliography` | BibliographyView |
| `knowledge-graph`, `application/vnd.knowledge-graph` | KnowledgeGraphView |
| (unknown) | FallbackView |

## MCP servers emitting artifacts

### pubmed-mcp
- Emits `application/vnd.bibliography` with JSON array of citations (authors, year, title, journal, pmid)

### medik-mcp
- Emits `application/vnd.knowledge-graph` from `get-everything`, `query-with-predicate`, and `get-connecting-paths`
- Content is JSON with `{ nodes: [...], links: [...] }` structure

### clinicalTrialGov-mcp
- Emits `text/markdown` with formatted clinical trial results

## Remaining work

### P1 — Protein Visualization
- Source reference: `charm-mcp/frontend-client/src/components/artifacts/ProteinVisualizationViewer.tsx`
- Uses Nightingale web components (@nightingale-elements) for protein sequence tracks, domains, variants
- Directly relevant to the PMI variant analysis use case
- Would need a MCP server (variant-domain or new) to emit `protein` artifacts

### P2 — Nice to have
- **Table viewer** — Render JSON arrays of objects as sortable tables
- **PFOCR viewer** — Biomedical figure extraction display (niche)

### How to add a new viewer

1. Create `frontend/src/components/artifacts/viewers/MyView.tsx` implementing `ViewerProps`
2. Add to `registry.ts`: `'my-type': () => import('./viewers/MyView')`
3. Have your MCP server return `artifacts: [{ type: 'my-type', title: '...', content: '...' }]`
