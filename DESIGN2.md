# CharmChat: Design & Migration Guide

## Why CharmChat?

CharmChat is a ground-up rewrite of charm-mcp, built around one principle: **keep only what matters**. The original charm-mcp grew organically into a 34K-line application with 52 dependencies, a SQL database, and deep coupling between its components. CharmChat delivers the same core experience in 3,500 lines with 19 dependencies and zero database overhead.

## By the Numbers

| Metric | charm-mcp | CharmChat | Reduction |
|--------|-----------|-----------|-----------|
| Lines of TypeScript | 33,789 | 3,529 | **~10x smaller** |
| Source files | 123 | 39 | 3.2x fewer |
| Production dependencies | 52 | 19 | 2.7x fewer |
| Avg lines per file | 275 | 91 | 3x shorter |
| Database | Prisma + SQLite | JSON files | No ORM |
| npm workspaces | 5 | 2 | Simpler monorepo |

## What Changed and Why

### 1. JSON Files Instead of Prisma + SQLite

charm-mcp used Prisma ORM with SQLite for conversations, graph state, and node/edge data. This required schema definitions, migrations, a generated client, and ~1,200 lines of database code.

CharmChat stores everything as JSON files in `data/`. One file per conversation, one config file for MCP servers, one for settings. The `StorageService` is 90 lines. For a single-user desktop app, this is the right trade-off:
- Human-readable and inspectable
- Easy to back up (copy the folder)
- No migration headaches
- Zero dependencies

### 2. Standard SSE Instead of Chunked JSON

charm-mcp used chunked transfer encoding with custom JSON framing for streaming. This required a bespoke parser on the frontend and made debugging difficult.

CharmChat uses standard Server-Sent Events (SSE). The protocol is simple:
```
event: delta
data: {"content": "Hello"}

event: artifact
data: {"id": "...", "type": "code", "title": "...", "content": "..."}

event: done
data: {}
```

Benefits:
- Browser-native protocol
- Easy to debug with curl
- The SSE parser is 30 lines

### 3. Inlined LLM Providers Instead of Adapter Classes

charm-mcp had a three-layer abstraction: provider → adapter → formatter. Each LLM required three files and ~400 lines to integrate. Adding a provider meant touching multiple modules and interfaces.

CharmChat has one file per provider (~120 lines each) implementing a single `LLMProvider` interface with one method: `async *stream()`. The provider handles its own message format conversion internally. Adding a new provider means creating one file.

### 4. Flat Tool Naming

charm-mcp used dash-separated tool names (`server-name-tool-name`), which caused ambiguity when server or tool names themselves contained dashes. CharmChat uses double-underscore separation (`server__tool_name`), making parsing unambiguous.

### 5. Modular Artifact System

charm-mcp supported 15+ artifact types with monolithic viewer components (some 50KB+). CharmChat uses a **registry pattern** — each viewer is a self-contained file in `viewers/`, registered by type string. The artifact `type` is an open `string` (not a closed union), so MCP servers can introduce new types without frontend changes. Unknown types fall back to preformatted text.

Current viewers: code, markdown, mermaid, html, image, json, bibliography, knowledge-graph. See `ARTIFACT_PORT.md` for details.

Artifacts come from two sources:
- `<artifact>` XML tags in LLM responses (parsed by regex)
- MCP tool results that include an `artifacts` array (forwarded to frontend via SSE)

### 6. No File Upload System

charm-mcp had a full file management system with multer uploads, UUID-based storage, metadata tracking, and file resolution helpers injected into Python code. This was ~2,000 lines across frontend and backend.

CharmChat omits file uploads entirely. For the Python MCP, files are passed through code. This can be added back if needed (see Migration Guide below).

### 7. Multi-Provider with Bedrock Support

Both apps support Anthropic, OpenAI, Gemini, and Ollama. CharmChat adds AWS Bedrock as a first-class provider — select "Bedrock" in the UI and it uses your AWS credentials directly, no API key needed.

## Architecture Overview

```
charmchat/
├── backend/          Express server (16 files)
│   └── src/
│       ├── routes/       chat (SSE), conversations, mcp, settings, models
│       ├── services/     chat orchestrator, mcp client, storage, llm providers
│       └── types/
├── frontend/         React SPA (21 files)
│   └── src/
│       ├── components/   sidebar, chat, artifacts, mcp, settings
│       ├── stores/       chatStore, mcpStore, settingsStore (Zustand)
│       └── lib/          api helpers, SSE parser
├── mcp-servers/      MCP server implementations
│   ├── python-mcp/   Sandboxed Python execution via Docker
│   ├── pubmed-mcp/   PubMed literature search
│   ├── medik-mcp/    MediKanren knowledge graph
│   ├── id-finder-mcp/ Entity normalization (ARAX)
│   ├── variant-domain-mcp/ Genomic variant → protein domain mapping
│   ├── hpa-mcp/      Human Protein Atlas
│   ├── chembl-mcp/   ChEMBL drug mechanisms
│   ├── clinicalTrialGov-mcp/ ClinicalTrials.gov search
│   ├── dgidb-mcp/    Drug-gene interactions
│   ├── string-db-mcp/ Protein-protein interactions (STRING)
│   ├── workflow-mcp/  Execute saved workflows
│   └── tooluniverse-mcp/ 100+ curated biomedical tools (Python/uv)
└── data/             Runtime data (gitignored)
    ├── conversations/  One JSON file per conversation
    └── config/         mcp-servers.json, settings.json
```

### Data Flow

```
User types message
  → chatStore.sendMessage()
  → POST /api/chat (SSE stream)
  → ChatService.run()
  → LLM provider streams response
  → Tool calls? → MCPService.callTool() → append result → loop
  → Parse <artifact> tags from response
  → SSE events: delta, tool_call, tool_result, artifact, done
  → Frontend updates in real-time
  → Auto-save conversation as JSON
```

## Migration Guide: Porting from charm-mcp

### Porting an MCP Server

MCP servers are standalone processes that communicate via stdio. Most charm-mcp servers can be used as-is.

**Steps:**

1. Copy the server directory into `mcp-servers/`:
   ```
   cp -r ../charm-mcp/custom-mcp-servers/your-mcp mcp-servers/
   ```

2. Install and build:
   ```
   cd mcp-servers/your-mcp && npm install && npm run build
   ```

3. Add to `data/config/mcp-servers.json`:
   ```json
   {
     "mcpServers": {
       "your-server": {
         "command": "node",
         "args": ["../mcp-servers/your-mcp/dist/index.js"],
         "env": { "API_KEY": "..." }
       }
     }
   }
   ```

4. Restart the backend. The server appears in Settings → MCP Servers.

**Servers that need modification:**

Servers that import from `../../shared/` or reference charm-mcp's file storage (`uploads/`, `metadata/`) will need those dependencies inlined or removed. The `mcpCodeUtils.ts` shared module is the most common dependency — copy the functions you need directly into the server.

### Porting the File Upload System

If you need file uploads:

1. Add `multer` to backend dependencies
2. Create a `POST /api/upload` route that stores files in `data/uploads/`
3. Add a file picker to `ChatInput.tsx`
4. Pass file references in the chat message to the MCP tool

### Adding a New Artifact Viewer

1. Create `frontend/src/components/artifacts/viewers/MyView.tsx` implementing `ViewerProps`
2. Add one line to `frontend/src/components/artifacts/registry.ts`
3. Have your MCP server return `artifacts: [{ type: 'my-type', title: '...', content: '...' }]`

No changes needed to ArtifactPanel, types, or backend. See `ARTIFACT_PORT.md` for details.

## Running

```bash
# Install everything
npm run install:all

# Build the Python MCP server (if using)
cd mcp-servers/python-mcp && npm run build && cd ../..

# Start both servers
npm run dev
# Backend: http://localhost:3001
# Frontend: http://localhost:5173

# Set your provider in the UI, configure API keys in Settings
# For Bedrock: just select "Bedrock" — uses AWS credentials from environment
```
