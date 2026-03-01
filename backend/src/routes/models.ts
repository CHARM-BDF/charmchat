import { Router } from 'express';
import type { Request, Response } from 'express';
import { Ollama } from 'ollama';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const models: Record<string, string[]> = {
      anthropic: [
        'claude-sonnet-4-20250514',
        'claude-haiku-4-5-20251001',
        'claude-opus-4-20250514',
      ],
      bedrock: [
        'global.anthropic.claude-sonnet-4-6',
        'global.anthropic.claude-haiku-4-5-20251001-v1:0',
        'global.anthropic.claude-opus-4-6-v1',
      ],
      openai: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini'],
      gemini: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
      ollama: ['llama3.2'],
    };

    // Try to fetch Ollama models dynamically
    try {
      const ollama = new Ollama({ host: process.env.OLLAMA_HOST || 'http://localhost:11434' });
      const response = await ollama.list();
      if (response.models && response.models.length > 0) {
        models.ollama = response.models.map(m => m.name);
      }
    } catch {
      // Ollama not available, use fallback
    }

    res.json(models);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
