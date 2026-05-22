import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Settings } from '../types/index.js';
import { StorageService } from '../services/storage.js';
import { isByokMode, BYOK_PROVIDERS } from '../services/byok.js';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  try {
    const storage: StorageService = req.app.locals.storage;
    const settings = storage.loadSettings();
    const byok = isByokMode();
    if (byok) {
      // Never return server-stored keys when BYOK is on. Even if some are
      // lingering on disk from a pre-BYOK run, hide them.
      settings.apiKeys = {};
    }
    res.json({
      ...settings,
      byok,
      byokProviders: byok ? BYOK_PROVIDERS : [],
      fixedModel: process.env.FIXED_MODEL || null,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.put('/', (req: Request, res: Response) => {
  try {
    const storage: StorageService = req.app.locals.storage;
    const settings = req.body as Settings;
    if (isByokMode()) {
      // Strip apiKeys at the boundary — never persist them in BYOK mode.
      settings.apiKeys = {};
    }
    storage.saveSettings(settings);
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
