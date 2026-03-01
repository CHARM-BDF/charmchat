import { GoogleGenAI, type Content, type Part, type Tool, type FunctionDeclaration } from '@google/genai';
import type { LLMProvider, StreamEvent, ChatMessage, ToolDefinition } from '../types.js';

export class GeminiProvider implements LLMProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async *stream(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    options?: { model?: string; temperature?: number; maxTokens?: number }
  ): AsyncIterable<StreamEvent> {
    const client = new GoogleGenAI({ apiKey: this.apiKey });
    const model = options?.model || 'gemini-2.0-flash';

    // Extract system instruction from first message if it's a system-like message
    let systemInstruction: string | undefined;
    const filteredMessages: ChatMessage[] = [];
    for (const msg of messages) {
      if (msg.role === 'user' && filteredMessages.length === 0 && msg.content.startsWith('[SYSTEM]')) {
        systemInstruction = msg.content.replace('[SYSTEM]', '').trim();
      } else {
        filteredMessages.push(msg);
      }
    }

    // Convert messages to Gemini contents format
    const contents: Content[] = [];
    for (const msg of filteredMessages) {
      if (msg.role === 'user') {
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

    // Convert tools to Gemini format
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
        // Process candidates
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

        // Usage metadata
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
