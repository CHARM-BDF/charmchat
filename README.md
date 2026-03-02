# CharmGPT2

A lightweight multi-provider LLM chat application with MCP tool integration and rich artifact display.

## Prerequisites

- **Node.js** 18+
- **Docker** (for the Python MCP server)
- **AWS credentials** configured (if using Bedrock)

## Installation

```bash
# 1. Install dependencies for backend and frontend
npm run install:all

# 2. Copy and edit environment variables
cp .env.example .env
# Add your API keys to .env:
#   ANTHROPIC_API_KEY=...
#   OPENAI_API_KEY=...
#   GOOGLE_API_KEY=...
#   AWS_REGION=us-east-1    (for Bedrock)
```

## Setting Up MCP Servers

### Python MCP Server

Runs Python code in a sandboxed Docker container with numpy, pandas, matplotlib, scikit-learn, and more pre-installed.

```bash
# 1. Pull and tag the Docker image
docker pull namin/my-python-mcp
docker tag namin/my-python-mcp my-python-mcp

# 2. Or build it yourself
cd mcp-servers/python-mcp
docker build -t my-python-mcp .

# 3. Install and build the MCP server
cd mcp-servers/python-mcp
npm install
npm run build
```

The Python server is pre-configured in `data/config/mcp-servers.json`.

### Adding Other MCP Servers

Edit `data/config/mcp-servers.json`:

```json
{
  "mcpServers": {
    "python": {
      "command": "node",
      "args": ["../mcp-servers/python-mcp/dist/index.js"]
    },
    "your-server": {
      "command": "node",
      "args": ["../mcp-servers/your-server/dist/index.js"],
      "env": {
        "API_KEY": "your-key-here"
      }
    }
  }
}
```

Paths are relative to the `backend/` directory. Restart the backend after editing.

Any MCP server that uses stdio transport is compatible — including servers from [charm-mcp](../charm-mcp), [Claude Desktop](https://modelcontextprotocol.io/docs/tools/desktop), or the [MCP server registry](https://github.com/modelcontextprotocol/servers).

## Running

```bash
# Start both backend and frontend
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001

Or run them separately:

```bash
npm run dev:backend   # Express server on :3001
npm run dev:frontend  # Vite dev server on :5173
```

## Usage

1. Open http://localhost:5173
2. Select a provider from the top bar (Anthropic, Bedrock, OpenAI, Gemini, Ollama)
3. Set API keys in Settings (gear icon in sidebar) — not needed for Bedrock or Ollama
4. Start chatting

### Features

- **Streaming responses** with real-time display
- **MCP tool use** — the LLM can call tools from connected MCP servers
- **Artifacts** — code, markdown, mermaid diagrams, and images render in a side panel
- **Conversations** — auto-saved as JSON files in `data/conversations/`
- **Dark/light theme** — toggle in Settings

## Project Structure

```
charmgpt2/
├── backend/              Express + TypeScript API server
│   └── src/
│       ├── routes/       API endpoints (chat, conversations, mcp, settings, models)
│       ├── services/     Chat orchestrator, LLM providers, MCP client, JSON storage
│       └── types/        Shared type definitions
├── frontend/             React + TypeScript SPA
│   └── src/
│       ├── components/   UI components (chat, artifacts, sidebar, settings)
│       ├── stores/       Zustand state management
│       └── lib/          API helpers, SSE parser
├── mcp-servers/          MCP server implementations
│   └── python-mcp/       Sandboxed Python execution via Docker
├── data/                 Runtime data (gitignored)
│   ├── conversations/    One JSON file per conversation
│   └── config/           mcp-servers.json, settings.json
├── DESIGN2.md            Architecture and migration guide
└── .env.example          Environment variable template
```

## Supported Providers

| Provider | API Key Required | Default Model |
|----------|-----------------|---------------|
| Anthropic | Yes | claude-sonnet-4-6 |
| Bedrock | No (uses AWS credentials) | global.anthropic.claude-sonnet-4-6 |
| OpenAI | Yes | gpt-5-mini-2025-08-07 |
| Gemini | Yes | gemini-2.5-flash |
| Ollama | No (local) | llama3.2 |
