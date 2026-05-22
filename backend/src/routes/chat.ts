import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Message, ChatMessage, ProviderName } from '../types/index.js';
import { ChatService } from '../services/chat.js';
import { LLMService } from '../services/llm/index.js';
import { MCPService } from '../services/mcp.js';
import { StorageService } from '../services/storage.js';
import { isByokMode, isByokProvider, scrubKeys } from '../services/byok.js';

const router = Router();

let toolIdCounter = 0;

function convertHistoryToMessages(history: Message[]): ChatMessage[] {
  const messages: ChatMessage[] = [];

  for (const msg of history) {
    if (msg.role === 'user') {
      messages.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        // Assistant message with tool calls
        const toolCalls = msg.toolCalls.map((tc) => ({
          id: `tool_${toolIdCounter++}`,
          name: tc.name,
          arguments: tc.args,
        }));
        messages.push({
          role: 'assistant',
          content: msg.content,
          toolCalls,
        });

        // Add tool results — match by position, not name
        for (let i = 0; i < msg.toolCalls.length; i++) {
          const tc = msg.toolCalls[i];
          if (tc.result !== undefined) {
            const resultStr = typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result);
            messages.push({
              role: 'tool',
              content: resultStr,
              toolCallId: toolCalls[i].id,
            });
          }
        }
      } else {
        messages.push({ role: 'assistant', content: msg.content });
      }
    }
  }

  return messages;
}

router.post('/', async (req: Request, res: Response) => {
  try {
    const { message, history = [], provider, model, blockedServers, blockedTools, apiKey } = req.body as {
      message: string;
      history: Message[];
      provider: ProviderName;
      model?: string;
      blockedServers?: string[];
      blockedTools?: string[];
      apiKey?: string;
    };

    if (!message || !provider) {
      res.status(400).json({ error: 'message and provider are required' });
      return;
    }

    const trimmedKey = apiKey?.trim();
    if (isByokMode() && isByokProvider(provider) && !trimmedKey) {
      res.status(400).json({ error: 'API key required (BYOK mode)' });
      return;
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const llmService: LLMService = req.app.locals.llmService;
    const mcpService: MCPService = req.app.locals.mcpService;
    const storage: StorageService = req.app.locals.storage;

    const chatService = new ChatService(llmService, mcpService, storage);

    // Build messages from history + new message
    const chatMessages = convertHistoryToMessages(history);
    chatMessages.push({ role: 'user', content: message });

    for await (const event of chatService.run(chatMessages, provider, { model, blockedServers, blockedTools, apiKey: trimmedKey })) {
      res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
    }

    res.end();
  } catch (error) {
    const safeError = scrubKeys(String(error));
    if (res.headersSent) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: safeError })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: safeError });
    }
  }
});

export default router;
