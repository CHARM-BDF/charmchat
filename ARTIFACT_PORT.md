# Artifact System: Design & Porting Plan

## Current State

charmgpt2 supports 5 artifact types: `code`, `markdown`, `mermaid`, `html`, `image`. Rendering is handled by a single `ArtifactPanel.tsx` that switches on type. This works but doesn't scale — adding a new artifact type means editing the panel component and adding inline rendering logic.

charm-mcp supported 17 types with dedicated viewers (some 50-70KB each), but the code was monolithic and tightly coupled. The Reagraph knowledge graph viewer alone was 50KB with filtering, clustering, and version history baked into one file.

## Design Principles

1. **Registry pattern** — Artifact viewers register themselves. Adding a new type = adding a new file, not touching the panel.
2. **One file per viewer** — Each artifact type gets its own component file. No 50KB god-components.
3. **Viewer interface** — Every viewer implements the same props contract: `{ content: string; title: string; metadata?: Record<string, unknown> }`.
4. **Lazy loading** — Heavy viewers (knowledge graph, protein viz) load on demand, not at startup.
5. **Graceful fallback** — Unknown types render as preformatted text. The system never breaks on an unrecognized type.
6. **MCP servers emit type hints** — The artifact type string drives which viewer is used. MCP servers can introduce new types without frontend changes (they'll fall back to text until a viewer is registered).

## Proposed Architecture

```
frontend/src/components/artifacts/
  ArtifactPanel.tsx          # Shell: tabs, controls, delegates to registry
  registry.ts                # Map<type, () => import('./viewers/...')>
  viewers/
    CodeBlock.tsx             # Existing
    MarkdownView.tsx          # Existing
    MermaidDiagram.tsx         # Existing
    HtmlView.tsx              # Existing (inline in ArtifactPanel today)
    ImageView.tsx             # Existing (inline in ArtifactPanel today)
    KnowledgeGraphView.tsx    # New — port from charm-mcp
    ProteinView.tsx           # New — port from charm-mcp
    BibliographyView.tsx      # New — port from charm-mcp
    JsonView.tsx              # New — syntax-highlighted JSON
    TableView.tsx             # New — tabular data rendering
```

### Registry

```typescript
// registry.ts
import { lazy, ComponentType } from 'react';

interface ViewerProps {
  content: string;
  title: string;
  metadata?: Record<string, unknown>;
}

const viewers: Record<string, () => Promise<{ default: ComponentType<ViewerProps> }>> = {
  'code':             () => import('./viewers/CodeBlock'),
  'markdown':         () => import('./viewers/MarkdownView'),
  'mermaid':          () => import('./viewers/MermaidDiagram'),
  'html':             () => import('./viewers/HtmlView'),
  'image':            () => import('./viewers/ImageView'),
  'knowledge-graph':  () => import('./viewers/KnowledgeGraphView'),
  'protein':          () => import('./viewers/ProteinView'),
  'bibliography':     () => import('./viewers/BibliographyView'),
  'json':             () => import('./viewers/JsonView'),
  'table':            () => import('./viewers/TableView'),
};

export function getViewer(type: string) {
  return viewers[type] || viewers['code']; // fallback to code (preformatted)
}
```

### ArtifactPanel changes

Instead of a switch statement on type, the panel does:

```typescript
const Viewer = lazy(getViewer(artifact.type));
return (
  <Suspense fallback={<LoadingSpinner />}>
    <Viewer content={artifact.content} title={artifact.title} />
  </Suspense>
);
```

## Porting Priority

### P0 — High value, directly supports current use cases

**Knowledge Graph Viewer**
- Source: `charm-mcp/frontend-client/src/components/artifacts/ReagraphKnowledgeGraphViewer.tsx` (50KB)
- Why: medik returns knowledge graph data that currently renders as raw JSON. This is the most visually impactful missing piece.
- Port strategy: Rewrite as a smaller component. The charm-mcp version has 3 levels of filtering, clustering, version history, and chat integration. Start with: render nodes + edges with entity-type coloring. Add filtering later if needed.
- Dependencies: `reagraph` (or simpler: `react-force-graph-2d`)
- Estimated complexity: Medium. The core rendering is ~200 lines; the 50KB was mostly filtering/clustering UI.

**Bibliography Viewer**
- Source: `charm-mcp/frontend-client/src/components/artifacts/ArtifactContent.tsx` (inline)
- Why: pubmed-mcp already emits `application/vnd.bibliography` artifacts — they're being silently dropped. This is free value.
- Port strategy: Simple component that renders a list of citations with PMIDs, authors, journal, year. Probably ~50 lines.
- Dependencies: None.
- Estimated complexity: Low.

### P1 — Valuable for the PMI variant analysis use case

**Protein Visualization**
- Source: `charm-mcp/frontend-client/src/components/artifacts/ProteinVisualizationViewer.tsx` (16KB)
- Why: Directly relevant to variant analysis (showing where a variant falls in protein domains). The EGFR case study would benefit from this.
- Port strategy: Uses Nightingale web components (@nightingale-elements). These are standard web components that render protein tracks. The viewer wraps them with a React component.
- Dependencies: `@nightingale-elements/nightingale-sequence`, `@nightingale-elements/nightingale-track`, etc.
- Estimated complexity: Medium. Web component integration with React can be fiddly.

### P2 — Nice to have

**JSON Viewer**
- Syntax-highlighted, collapsible JSON rendering. Currently JSON artifacts render as plain code blocks.
- Port strategy: Write from scratch, ~100 lines. Collapsible tree with syntax highlighting.
- Dependencies: None (or use existing code highlighter).
- Estimated complexity: Low.

**Table Viewer**
- Render tabular data (CSV, TSV, or JSON arrays of objects) as sortable tables.
- Port strategy: Write from scratch. Detect if content is tabular, render as `<table>`.
- Dependencies: None.
- Estimated complexity: Low.

### Not porting

- **PFOCR Viewer** — Too niche. Can be added later if needed.
- **GraphModeViewer** (69KB) — The "conversation-driven graph exploration" mode. Interesting but architecturally complex and tightly coupled to a specific UX paradigm. The simpler KnowledgeGraphView covers the core need.
- **CodeEditorView** — charmgpt2 doesn't have code execution in the frontend. The python-mcp handles execution server-side.
- **React component rendering** — Security concerns, limited use.

## Backend Changes Needed

### Artifact type expansion
In `backend/src/types/index.ts` and `frontend/src/types/index.ts`, change:
```typescript
// From:
type: 'code' | 'markdown' | 'mermaid' | 'html' | 'image'
// To:
type: string  // Open-ended, viewers registered in frontend
```

This allows MCP servers to introduce new artifact types without backend changes.

### Artifact parsing
The backend already parses `<artifact type="..." title="...">` tags from LLM responses. It currently validates against the 5 known types. This validation should be relaxed to pass through any type string.

### MCP server artifact support
MCP tool results can include artifacts (pubmed-mcp already does this with bibliography). The backend should forward these to the frontend. Check if this path is currently working or if artifacts from MCP results are being dropped.

## Migration Steps

1. Refactor ArtifactPanel to use registry pattern (no new viewers yet, just restructure)
2. Move existing inline viewers (html, image) into separate files
3. Open up artifact type to `string`
4. Add BibliographyView (lowest effort, immediate value)
5. Add KnowledgeGraphView (highest impact)
6. Add ProteinView (PMI use case)
7. Add JSON/Table viewers as needed
