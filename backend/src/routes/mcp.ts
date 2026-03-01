import { Router } from 'express';
import type { Request, Response } from 'express';
import { MCPService } from '../services/mcp.js';
import { StorageService } from '../services/storage.js';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  try {
    const mcpService: MCPService = req.app.locals.mcpService;
    const servers = mcpService.getStatus();
    res.json({ servers });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/restart', async (req: Request, res: Response) => {
  try {
    const mcpService: MCPService = req.app.locals.mcpService;
    const storage: StorageService = req.app.locals.storage;

    const config = storage.loadMcpConfig();
    await mcpService.initialize(config);

    const servers = mcpService.getStatus();
    res.json({ servers });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
