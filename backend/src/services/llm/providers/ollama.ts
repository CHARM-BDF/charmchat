import { Ollama } from 'ollama';
import type { LLMProvider, StreamEvent, ChatMessage, ToolDefinition } from '../types.js';

export class OllamaProvider implements LLMProvider {
  private host: string;

  constructor(host?: string) {
    this.host = host || 'http://localhost:11434';
  }

  async *stream(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    options?: { model?: string; temperature?: number; maxTokens?: number }
  ): AsyncIterable<StreamEvent> {
    const client = new Ollama({ host: this.host });
    const model = options?.model || 'llama3.2';

    // Convert messages to Ollama format
    const ollamaMessages = messages.map(msg => {
      if (msg.role === 'tool') {
        return {
          role: 'tool' as const,
          content: msg.content,
        };
      }
      return {
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      };
    });

    // Convert tools to Ollama format (if provided)
    const ollamaTools = tools?.length
      ? tools.map(t => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          },
        }))
      : undefined;

    try {
      const response = await client.chat({
        model,
        messages: ollamaMessages,
        stream: true,
        ...(ollamaTools ? { tools: ollamaTools } : {}),
        ...(options?.temperature !== undefined
          ? { options: { temperature: options.temperature } }
          : {}),
      });

      for await (const chunk of response) {
        if (chunk.message?.content) {
          yield { type: 'delta', content: chunk.message.content };
        }

        // Handle tool calls if present
        if (chunk.message?.tool_calls) {
          for (const tc of chunk.message.tool_calls) {
            yield {
              type: 'tool_call',
              toolCall: {
                id: `ollama_${Date.now()}`,
                name: tc.function?.name || '',
                arguments: (tc.function?.arguments || {}) as Record<string, unknown>,
              },
            };
          }
        }

        if (chunk.done) {
          yield {
            type: 'done',
            usage: {
              promptTokens: chunk.prompt_eval_count || 0,
              completionTokens: chunk.eval_count || 0,
            },
          };
        }
      }
    } catch (error) {
      yield { type: 'error', error: String(error) };
    }
  }
}
