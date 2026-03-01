import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Conversation } from '../types/index.js';
import { StorageService } from '../services/storage.js';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  try {
    const storage: StorageService = req.app.locals.storage;
    const conversations = storage.listConversations();
    res.json(conversations);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/:id', (req: Request, res: Response) => {
  try {
    const storage: StorageService = req.app.locals.storage;
    const conversation = storage.loadConversation(req.params.id);
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.put('/:id', (req: Request, res: Response) => {
  try {
    const storage: StorageService = req.app.locals.storage;
    const conversation = req.body as Conversation;
    conversation.id = req.params.id;
    const now = new Date().toISOString();
    const existing = storage.loadConversation(req.params.id);
    conversation.created = conversation.created || existing?.created || now;
    conversation.updated = now;
    storage.saveConversation(conversation);
    res.json(conversation);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.delete('/:id', (req: Request, res: Response) => {
  try {
    const storage: StorageService = req.app.locals.storage;
    storage.deleteConversation(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
