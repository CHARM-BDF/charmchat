import { Router } from 'express';
import type { Request, Response } from 'express';
import { Ollama } from 'ollama';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    // If FIXED_MODEL is set (e.g. "vertex:claude-sonnet-4-6"), only expose that one combo
    const fixedModel = process.env.FIXED_MODEL;
    if (fixedModel) {
      const [provider, ...rest] = fixedModel.split(':');
      const model = rest.join(':');
      if (provider && model) {
        res.json({ [provider]: [model] });
        return;
      }
    }

    const models: Record<string, string[]> = {
      anthropic: [
        'claude-sonnet-4-6',
        'claude-haiku-4-5',
        'claude-opus-4-6',
      ],
      bedrock: [
        'global.anthropic.claude-sonnet-4-6',
        'global.anthropic.claude-haiku-4-5-20251001-v1:0',
        'global.anthropic.claude-opus-4-6-v1',
        'global.anthropic.claude-opus-4-7',
      ],
      openai: ['gpt-5-mini-2025-08-07', 'gpt-5.2-2025-12-11', 'gpt-4.1-2025-04-14'],
      gemini: ['gemini-2.5-flash', 'gemini-3-flash-preview', 'gemini-2.5-pro'],
      vertex: [
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'claude-sonnet-4-6',
        'claude-haiku-4-5',
        'claude-opus-4-6',
      ],
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
