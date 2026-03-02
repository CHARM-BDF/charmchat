import OpenAI from 'openai';
import type { LLMProvider, StreamEvent, ChatMessage, ToolDefinition } from '../types.js';

export class OpenAIProvider implements LLMProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async *stream(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    options?: { model?: string; temperature?: number; maxTokens?: number }
  ): AsyncIterable<StreamEvent> {
    const client = new OpenAI({ apiKey: this.apiKey });
    const model = options?.model || 'gpt-5-mini-2025-08-07';

    // Convert messages to OpenAI format
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = messages.map(msg => {
      if (msg.role === 'system') {
        return { role: 'system' as const, content: msg.content };
      } else if (msg.role === 'user') {
        return { role: 'user' as const, content: msg.content };
      } else if (msg.role === 'assistant') {
        const result: OpenAI.ChatCompletionAssistantMessageParam = {
          role: 'assistant' as const,
          content: msg.content || null,
        };
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          result.tool_calls = msg.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }));
        }
        return result;
      } else if (msg.role === 'tool') {
        return {
          role: 'tool' as const,
          content: msg.content,
          tool_call_id: msg.toolCallId || '',
        };
      }
      return { role: 'user' as const, content: msg.content };
    });

    // Convert tools to OpenAI format
    const openaiTools: OpenAI.ChatCompletionTool[] | undefined = tools?.length
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
      const stream = await client.chat.completions.create({
        model,
        messages: openaiMessages,
        stream: true,
        ...(openaiTools ? { tools: openaiTools } : {}),
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
      });

      const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
      let promptTokens = 0;
      let completionTokens = 0;

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta;

        // Text content
        if (delta.content) {
          yield { type: 'delta', content: delta.content };
        }

        // Tool calls
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCalls.has(idx)) {
              toolCalls.set(idx, { id: tc.id || '', name: '', arguments: '' });
            }
            const current = toolCalls.get(idx)!;
            if (tc.id) current.id = tc.id;
            if (tc.function?.name) current.name = tc.function.name;
            if (tc.function?.arguments) current.arguments += tc.function.arguments;
          }
        }

        // Usage info
        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens;
          completionTokens = chunk.usage.completion_tokens;
        }

        // Finish
        if (choice.finish_reason) {
          // Emit accumulated tool calls
          for (const [, tc] of toolCalls) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.arguments || '{}');
            } catch {
              // empty
            }
            yield {
              type: 'tool_call',
              toolCall: { id: tc.id, name: tc.name, arguments: args },
            };
          }

          yield {
            type: 'done',
            usage: { promptTokens, completionTokens },
          };
        }
      }
    } catch (error) {
      yield { type: 'error', error: String(error) };
    }
  }
}
