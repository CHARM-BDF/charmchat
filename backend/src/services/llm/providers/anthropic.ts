import Anthropic from '@anthropic-ai/sdk';
import AnthropicBedrock from '@anthropic-ai/bedrock-sdk';
import type { LLMProvider, StreamEvent, ChatMessage, ToolDefinition } from '../types.js';

type Client = Anthropic | AnthropicBedrock;

export class AnthropicProvider implements LLMProvider {
  private client: Client;

  constructor(opts: { apiKey?: string; bedrock?: boolean; awsRegion?: string }) {
    if (opts.bedrock) {
      this.client = new AnthropicBedrock({
        awsRegion: opts.awsRegion || process.env.AWS_REGION || 'us-east-1',
      });
    } else {
      this.client = new Anthropic({ apiKey: opts.apiKey });
    }
  }

  async *stream(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    options?: { model?: string; temperature?: number; maxTokens?: number }
  ): AsyncIterable<StreamEvent> {
    const model = options?.model || 'claude-sonnet-4-20250514';

    // Extract system messages and convert the rest
    let system: string | undefined;
    const anthropicMessages: Anthropic.MessageParam[] = [];
    for (const msg of messages) {
      if (msg.role === 'system') {
        system = system ? `${system}\n\n${msg.content}` : msg.content;
      } else if (msg.role === 'user') {
        anthropicMessages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          const content: Anthropic.ContentBlockParam[] = [];
          if (msg.content) {
            content.push({ type: 'text', text: msg.content });
          }
          for (const tc of msg.toolCalls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments as Record<string, unknown>,
            });
          }
          anthropicMessages.push({ role: 'assistant', content });
        } else {
          anthropicMessages.push({ role: 'assistant', content: msg.content });
        }
      } else if (msg.role === 'tool') {
        anthropicMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolCallId || '',
              content: msg.content,
            },
          ],
        });
      }
    }

    // Convert tools to Anthropic format
    const anthropicTools: Anthropic.Tool[] | undefined = tools?.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));

    const streamParams: Anthropic.MessageCreateParamsStreaming = {
      model,
      max_tokens: options?.maxTokens || 8192,
      messages: anthropicMessages,
      stream: true,
    };

    if (system) {
      streamParams.system = system;
    }
    if (anthropicTools && anthropicTools.length > 0) {
      streamParams.tools = anthropicTools;
    }
    if (options?.temperature !== undefined) {
      streamParams.temperature = options.temperature;
    }

    const response = this.client.messages.stream(streamParams);

    let currentToolId = '';
    let currentToolName = '';
    let currentToolJson = '';
    let promptTokens = 0;
    let completionTokens = 0;

    try {
      for await (const event of response) {
        if (event.type === 'content_block_start') {
          const block = event.content_block;
          if (block.type === 'tool_use') {
            currentToolId = block.id;
            currentToolName = block.name;
            currentToolJson = '';
          }
        } else if (event.type === 'content_block_delta') {
          const delta = event.delta;
          if (delta.type === 'text_delta') {
            yield { type: 'delta', content: delta.text };
          } else if (delta.type === 'input_json_delta') {
            currentToolJson += delta.partial_json;
          }
        } else if (event.type === 'content_block_stop') {
          if (currentToolId) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(currentToolJson || '{}');
            } catch {
              // empty args
            }
            yield {
              type: 'tool_call',
              toolCall: {
                id: currentToolId,
                name: currentToolName,
                arguments: args,
              },
            };
            currentToolId = '';
            currentToolName = '';
            currentToolJson = '';
          }
        } else if (event.type === 'message_delta') {
          if (event.usage) {
            completionTokens = event.usage.output_tokens;
          }
        } else if (event.type === 'message_start') {
          if (event.message?.usage) {
            promptTokens = event.message.usage.input_tokens;
          }
        } else if (event.type === 'message_stop') {
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
