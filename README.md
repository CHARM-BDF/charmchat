# CharmChat

A lightweight multi-provider LLM chat application with MCP tool integration and rich artifact display.

## Prerequisites

- **Node.js** 18+
- **Docker** (for the Python MCP server)
- **AWS credentials** configured (if using Bedrock)
- **Google Cloud ADC** configured (if using Vertex AI) — `gcloud auth application-default login`

## Installation

```bash
# 1. Install dependencies for backend and frontend
npm run install:all

# 2. Copy and edit environment variables
cp .env.example backend/.env
# Add your API keys to backend/.env:
#   ANTHROPIC_API_KEY=...
#   OPENAI_API_KEY=...
#   GOOGLE_API_KEY=...
#   AWS_REGION=us-east-1    (for Bedrock)
#   GOOGLE_CLOUD_PROJECT=your-project  (for Vertex AI)
#   GOOGLE_CLOUD_LOCATION=us-central1  (for Vertex AI)

# 3. Copy default config files
mkdir -p data/config
cp mcp-servers.example.json data/config/mcp-servers.json
cp settings.example.json data/config/settings.json
```

## Setting Up MCP Servers

The example config includes all MCP servers in the repo. After copying it (step 3 above), they'll be available once built.

```bash
# Install and build all Node MCP servers
npm run install:mcps
```

### Python MCP Server

The Python MCP server also requires a Docker image for sandboxed execution:

```bash
# Pull and tag the Docker image
docker pull namin/my-python-mcp
docker tag namin/my-python-mcp my-python-mcp

# Or build it yourself
cd mcp-servers/python-mcp
docker build -t my-python-mcp .
```

### ToolUniverse MCP Server (Python/uv)

The ToolUniverse server is a Python project managed by [uv](https://docs.astral.sh/uv/) and is not included in `install:mcps`. It requires no separate build step — it runs directly via `uv run`.

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
2. Select a provider from the top bar (Anthropic, Bedrock, OpenAI, Gemini, Vertex AI, Ollama)
3. Set API keys in Settings (gear icon in sidebar) — not needed for Bedrock, Vertex AI, or Ollama
4. Start chatting

### Features

- **Streaming responses** with real-time display
- **MCP tool use** — the LLM can call tools from connected MCP servers
- **Artifacts** — code, markdown, mermaid diagrams, and images render in a side panel
- **Conversations** — auto-saved as JSON files in `data/conversations/`
- **Dark/light theme** — toggle in Settings

## Project Structure

```
charmchat/
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
| Vertex AI | No (uses Google Cloud ADC) | gemini-2.5-flash |
| Ollama | No (local) | llama3.2 |

Vertex AI supports both Gemini and Claude models through a single provider. Set `GOOGLE_CLOUD_PROJECT` and run `gcloud auth application-default login` for authentication.

### Restricting Available Providers

Set `FIXED_PROVIDERS` in `backend/.env` to a comma-separated list to expose only those providers in the UI:

```
FIXED_PROVIDERS=anthropic,openai,gemini
```

Providers not in the list are hidden from the settings dropdown. Use this to e.g. show direct-API Gemini but hide Vertex AI, or to drop Bedrock/Ollama from a deployment. Ignored when `FIXED_MODEL` is set (which is the stricter form).

## Bring-Your-Own-Key (BYOK) Mode

Set `BYOK=true` in `backend/.env` to switch into BYOK mode. In this mode:

- API keys are stored **only in the user's browser** (localStorage), never on the server.
- Each chat / workflow-extract request includes the key in its body. The server uses it for that request and discards it — nothing is written to disk.
- `GET /api/settings` will not return any stored `apiKeys`, and `PUT /api/settings` strips them at the boundary.
- Applies to Anthropic, OpenAI, and Gemini. Bedrock / Vertex / Ollama still use server-side credentials.

Pair it with `FIXED_MODEL=anthropic:claude-sonnet-4-6` to lock the deployment to a single provider/model:

```
BYOK=true
FIXED_MODEL=anthropic:claude-sonnet-4-6
```

When BYOK is on and no key is set for the active provider, the chat composer is disabled and a "Open Settings" prompt is shown.
