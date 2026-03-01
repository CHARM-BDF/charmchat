import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Settings } from '../types/index.js';
import { StorageService } from '../services/storage.js';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  try {
    const storage: StorageService = req.app.locals.storage;
    const settings = storage.loadSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.put('/', (req: Request, res: Response) => {
  try {
    const storage: StorageService = req.app.locals.storage;
    const settings = req.body as Settings;
    storage.saveSettings(settings);
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
