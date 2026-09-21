import AnthropicVertex from '@anthropic-ai/vertex-sdk';
import { GoogleGenAI } from '@google/genai';
import { GoogleAuth } from 'google-auth-library';
import { streamClaude } from './anthropic.js';
import { streamGenAI } from './gemini.js';
import { OpenAIProvider } from './openai.js';
import type { LLMProvider, StreamEvent, ChatMessage, ToolDefinition } from '../types.js';

export class VertexProvider implements LLMProvider {
  private project: string;
  private location: string;

  constructor(opts: { project?: string; location?: string }) {
    this.project = opts.project || process.env.GOOGLE_CLOUD_PROJECT || '';
    // Gemini 3.x and the newest Claude models are served from the global endpoint
    this.location = opts.location || process.env.GOOGLE_CLOUD_LOCATION || 'global';
  }

  async *stream(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    options?: { model?: string; temperature?: number; maxTokens?: number }
  ): AsyncIterable<StreamEvent> {
    const model = options?.model || 'gemini-3.8-flash';

    if (model.startsWith('claude')) {
      const client = new AnthropicVertex({ projectId: this.project, region: this.location });
      yield* streamClaude(client, messages, tools, { ...options, model });
    } else if (model.startsWith('openai/')) {
      yield* this.streamOpenAI(messages, tools, { ...options, model });
    } else {
      const client = new GoogleGenAI({ vertexai: true, project: this.project, location: this.location });
      yield* streamGenAI(client, messages, tools, { ...options, model });
    }
  }

  // OpenAI's open-weight models (gpt-oss) are served through Vertex's OpenAI-compatible endpoint
  private async *streamOpenAI(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    options?: { model?: string; temperature?: number; maxTokens?: number }
  ): AsyncIterable<StreamEvent> {
    let token: string | null | undefined;
    try {
      const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });
      token = await auth.getAccessToken();
    } catch (error) {
      yield { type: 'error', error: String(error) };
      return;
    }
    const host = this.location === 'global' ? 'aiplatform.googleapis.com' : `${this.location}-aiplatform.googleapis.com`;
    const baseURL = `https://${host}/v1/projects/${this.project}/locations/${this.location}/endpoints/openapi`;
    yield* new OpenAIProvider(token || '', baseURL).stream(messages, tools, options);
  }
}
