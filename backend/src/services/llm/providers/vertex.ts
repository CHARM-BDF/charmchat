import Anthropic from '@anthropic-ai/sdk';
import AnthropicVertex from '@anthropic-ai/vertex-sdk';
import { GoogleGenAI, type Content, type Part, type Tool, type FunctionDeclaration } from '@google/genai';
import type { LLMProvider, StreamEvent, ChatMessage, ToolDefinition } from '../types.js';

export class VertexProvider implements LLMProvider {
  private project: string;
  private location: string;

  constructor(opts: { project?: string; location?: string }) {
    this.project = opts.project || process.env.GOOGLE_CLOUD_PROJECT || '';
    this.location = opts.location || process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
  }

  async *stream(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    options?: { model?: string; temperature?: number; maxTokens?: number }
  ): AsyncIterable<StreamEvent> {
    const model = options?.model || 'gemini-2.5-flash';

    if (model.startsWith('claude')) {
      yield* this.streamClaude(messages, tools, { ...options, model });
    } else {
      yield* this.streamGemini(messages, tools, { ...options, model });
    }
  }

  private async *streamClaude(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    options?: { model?: string; temperature?: number; maxTokens?: number }
  ): AsyncIterable<StreamEvent> {
    const client = new AnthropicVertex({
      projectId: this.project,
      region: this.location,
    });
    const model = options?.model || 'claude-sonnet-4-6';

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

    const response = client.messages.stream(streamParams);

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

  private async *streamGemini(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    options?: { model?: string; temperature?: number; maxTokens?: number }
  ): AsyncIterable<StreamEvent> {
    const client = new GoogleGenAI({
      vertexai: true,
      project: this.project,
      location: this.location,
    });
    const model = options?.model || 'gemini-2.5-flash';

    // Extract system messages and convert the rest
    let systemInstruction: string | undefined;
    const contents: Content[] = [];
    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction = systemInstruction ? `${systemInstruction}\n\n${msg.content}` : msg.content;
      } else if (msg.role === 'user') {
        contents.push({
          role: 'user',
          parts: [{ text: msg.content }],
        });
      } else if (msg.role === 'assistant') {
        const parts: Part[] = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          for (const tc of msg.toolCalls) {
            parts.push({
              functionCall: {
                name: tc.name,
                args: tc.arguments as Record<string, unknown>,
              },
            });
          }
        }
        contents.push({ role: 'model', parts });
      } else if (msg.role === 'tool') {
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: msg.toolCallId || 'unknown',
                response: { result: msg.content },
              },
            },
          ],
        });
      }
    }

    const geminiTools: Tool[] | undefined = tools?.length
      ? [
          {
            functionDeclarations: tools.map(
              (t): FunctionDeclaration => ({
                name: t.name,
                description: t.description,
                parameters: t.inputSchema as Record<string, unknown>,
              })
            ),
          },
        ]
      : undefined;

    try {
      const response = await client.models.generateContentStream({
        model,
        contents,
        config: {
          ...(systemInstruction ? { systemInstruction } : {}),
          ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
          ...(options?.maxTokens ? { maxOutputTokens: options.maxTokens } : {}),
          ...(geminiTools ? { tools: geminiTools } : {}),
        },
      });

      let promptTokens = 0;
      let completionTokens = 0;

      for await (const chunk of response) {
        if (chunk.candidates && chunk.candidates.length > 0) {
          const candidate = chunk.candidates[0];
          if (candidate.content?.parts) {
            for (const part of candidate.content.parts) {
              if (part.text) {
                yield { type: 'delta', content: part.text };
              }
              if (part.functionCall) {
                yield {
                  type: 'tool_call',
                  toolCall: {
                    id: part.functionCall.name || 'call',
                    name: part.functionCall.name || '',
                    arguments: (part.functionCall.args || {}) as Record<string, unknown>,
                  },
                };
              }
            }
          }
        }

        if (chunk.usageMetadata) {
          promptTokens = chunk.usageMetadata.promptTokenCount || 0;
          completionTokens = chunk.usageMetadata.candidatesTokenCount || 0;
        }
      }

      yield {
        type: 'done',
        usage: { promptTokens, completionTokens },
      };
    } catch (error) {
      yield { type: 'error', error: String(error) };
    }
  }
}
