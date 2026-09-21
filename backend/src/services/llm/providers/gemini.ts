import { GoogleGenAI, type Content, type Part, type Tool, type FunctionDeclaration } from '@google/genai';
import { v4 as uuidv4 } from 'uuid';
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
    yield* streamGenAI(client, messages, tools, options);
  }
}

// Shared by the Gemini (API key) and Vertex providers.
export async function* streamGenAI(
  client: GoogleGenAI,
  messages: ChatMessage[],
  tools?: ToolDefinition[],
  options?: { model?: string; temperature?: number; maxTokens?: number }
): AsyncIterable<StreamEvent> {
  const model = options?.model || 'gemini-2.5-flash';

  // Extract system messages and convert the rest
  let systemInstruction: string | undefined;
  const contents: Content[] = [];
  // Tool results only carry our call id; Gemini matches responses by function name.
  const toolNames = new Map<string, string>();
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
          toolNames.set(tc.id, tc.name);
          parts.push({
            functionCall: {
              name: tc.name,
              args: tc.arguments as Record<string, unknown>,
            },
            // Gemini 3 rejects function calls sent back without their signature
            ...(tc.thoughtSignature ? { thoughtSignature: tc.thoughtSignature } : {}),
          });
        }
      }
      contents.push({ role: 'model', parts });
    } else if (msg.role === 'tool') {
      const part: Part = {
        functionResponse: {
          name: toolNames.get(msg.toolCallId || '') || msg.toolCallId || 'unknown',
          response: { result: msg.content },
        },
      };
      // All responses to one model turn must go back in a single user turn
      const last = contents[contents.length - 1];
      if (last?.role === 'user' && last.parts?.every(p => p.functionResponse)) {
        last.parts.push(part);
      } else {
        contents.push({ role: 'user', parts: [part] });
      }
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
              // Full JSON Schema; MCP schemas ($schema, additionalProperties) passed as
              // `parameters` make Gemini 3.1 Pro emit malformed function calls
              parametersJsonSchema: t.inputSchema,
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
              const name = part.functionCall.name || '';
              yield {
                type: 'tool_call',
                toolCall: {
                  // Gemini 2.5 omits ids, and parallel calls often share a name
                  id: part.functionCall.id || `${name}_${uuidv4()}`,
                  name,
                  arguments: (part.functionCall.args || {}) as Record<string, unknown>,
                  ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
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
