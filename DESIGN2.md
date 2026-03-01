# CharmGPT2: Design & Migration Guide

## Why CharmGPT2?

CharmGPT2 is a ground-up rewrite of charm-mcp, built around one principle: **keep only what matters**. The original charm-mcp grew organically into a 34K-line application with 52 dependencies, a SQL database, and deep coupling between its components. CharmGPT2 delivers the same core experience in 3,500 lines with 19 dependencies and zero database overhead.

## By the Numbers

| Metric | charm-mcp | CharmGPT2 | Reduction |
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

CharmGPT2 stores everything as JSON files in `data/`. One file per conversation, one config file for MCP servers, one for settings. The `StorageService` is 90 lines. For a single-user desktop app, this is the right trade-off:
- Human-readable and inspectable
- Easy to back up (copy the folder)
- No migration headaches
- Zero dependencies

### 2. Standard SSE Instead of Chunked JSON

charm-mcp used chunked transfer encoding with custom JSON framing for streaming. This required a bespoke parser on the frontend and made debugging difficult.

CharmGPT2 uses standard Server-Sent Events (SSE). The protocol is simple:
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

CharmGPT2 has one file per provider (~120 lines each) implementing a single `LLMProvider` interface with one method: `async *stream()`. The provider handles its own message format conversion internally. Adding a new provider means creating one file.

### 4. Flat Tool Naming

charm-mcp used dash-separated tool names (`server-name-tool-name`), which caused ambiguity when server or tool names themselves contained dashes. CharmGPT2 uses double-underscore separation (`server__tool_name`), making parsing unambiguous.

### 5. Simplified Artifact System

charm-mcp supported 15+ artifact types including knowledge graphs, protein visualizations, bibliography entries, and React components. Each type required a dedicated viewer component and type definitions.

CharmGPT2 supports 5 types: `code`, `markdown`, `mermaid`, `html`, and `image`. These cover the vast majority of use cases. The system prompt instructs the LLM to use `<artifact>` XML tags, and a simple regex parser extracts them. Images from MCP tool results (like matplotlib plots) are handled as base64 data URIs.

### 6. No File Upload System

charm-mcp had a full file management system with multer uploads, UUID-based storage, metadata tracking, and file resolution helpers injected into Python code. This was ~2,000 lines across frontend and backend.

CharmGPT2 omits file uploads entirely. For the Python MCP, files are passed through code. This can be added back if needed (see Migration Guide below).

### 7. Multi-Provider with Bedrock Support

Both apps support Anthropic, OpenAI, Gemini, and Ollama. CharmGPT2 adds AWS Bedrock as a first-class provider — select "Bedrock" in the UI and it uses your AWS credentials directly, no API key needed.

## Architecture Overview

```
charmgpt2/
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
│   └── python-mcp/   Sandboxed Python execution via Docker
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

### Porting Knowledge Graph Visualization

If you need graph support:

1. Add `reagraph` or `react-force-graph-2d` to frontend dependencies
2. Create a `GraphView.tsx` artifact component
3. Add `'graph'` to the artifact type union
4. Update `ArtifactPanel.tsx` to render it

### Porting Additional Artifact Types

The artifact system is extensible. To add a new type:

1. Add the type to the `Artifact.type` union in both `backend/src/types/index.ts` and `frontend/src/types/index.ts`
2. Create a viewer component in `frontend/src/components/artifacts/`
3. Add a case to `ArtifactPanel.tsx`
4. Update the system prompt in `backend/src/services/chat.ts` to tell the LLM about the new type

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
