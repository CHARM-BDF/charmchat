import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ProviderName } from '../types/index.js';
import { LLMService } from '../services/llm/index.js';
import { MCPService } from '../services/mcp.js';
import { StorageService } from '../services/storage.js';
import { PicrophantService } from '../services/picrophant.js';
import { isByokMode, isByokProvider, scrubKeys } from '../services/byok.js';

const router = Router();

// POST /api/picrophant/challenge — adversarially challenge a report (SSE stream)
router.post('/challenge', async (req: Request, res: Response) => {
  const llmService: LLMService = req.app.locals.llmService;
  const mcpService: MCPService = req.app.locals.mcpService;
  const storage: StorageService = req.app.locals.storage;

  const { report, claims, focus, provider, model, apiKey: bodyKey } = req.body as {
    report?: string;
    claims?: string[];
    focus?: string;
    provider?: ProviderName;
    model?: string;
    apiKey?: string;
  };

  if (!report || !provider) {
    res.status(400).json({ error: 'report and provider are required' });
    return;
  }

  if (isByokMode() && isByokProvider(provider) && !bodyKey) {
    res.status(400).json({ error: 'API key required (BYOK mode)' });
    return;
  }

  let apiKey: string | undefined;
  if (isByokMode() && isByokProvider(provider)) {
    apiKey = bodyKey;
  } else {
    apiKey = bodyKey || storage.loadSettings().apiKeys[provider];
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  try {
    const picrophant = new PicrophantService(llmService, mcpService);
    for await (const event of picrophant.challengeStream(
      { report, claims, focus },
      { provider, model, apiKey }
    )) {
      res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
    }
    res.end();
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: scrubKeys(String(error)) });
    } else {
      res.write(`event: error\ndata: ${JSON.stringify({ error: scrubKeys(String(error)) })}\n\n`);
      res.end();
    }
  }
});

export default router;
