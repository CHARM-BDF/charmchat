import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { StorageService } from './services/storage.js';
import { LLMService } from './services/llm/index.js';
import { MCPService } from './services/mcp.js';
import chatRoutes from './routes/chat.js';
import conversationRoutes from './routes/conversations.js';
import mcpRoutes from './routes/mcp.js';
import settingsRoutes from './routes/settings.js';
import modelsRoutes from './routes/models.js';

const PORT = parseInt(process.env.PORT || '3001', 10);

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Initialize services
const storage = new StorageService();
const llmService = new LLMService();
const mcpService = new MCPService();

// Store in app.locals for route access
app.locals.storage = storage;
app.locals.llmService = llmService;
app.locals.mcpService = mcpService;

// Mount routes
app.use('/api/chat', chatRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/mcp', mcpRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/models', modelsRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Initialize MCP servers from stored config
async function start() {
  try {
    const mcpConfig = storage.loadMcpConfig();
    if (Object.keys(mcpConfig.mcpServers).length > 0) {
      console.log('Initializing MCP servers...');
      await mcpService.initialize(mcpConfig);
      const statuses = mcpService.getStatus();
      for (const s of statuses) {
        console.log(`  ${s.name}: ${s.status}${s.error ? ` (${s.error})` : ''} - ${s.tools.length} tools`);
      }
    }
  } catch (err) {
    console.error('Failed to initialize MCP servers:', err);
  }

  app.listen(PORT, () => {
    console.log(`CharmGPT2 backend running on http://localhost:${PORT}`);
  });
}

// Graceful shutdown
function shutdown() {
  console.log('\nShutting down...');
  mcpService.cleanup().then(() => {
    process.exit(0);
  }).catch(() => {
    process.exit(1);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
