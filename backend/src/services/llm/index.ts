import type { ProviderName, LLMProvider } from '../../types/index.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { OpenAIProvider } from './providers/openai.js';
import { GeminiProvider } from './providers/gemini.js';
import { OllamaProvider } from './providers/ollama.js';
import { VertexProvider } from './providers/vertex.js';

export class LLMService {
  createProvider(name: ProviderName, apiKey?: string): LLMProvider {
    switch (name) {
      case 'anthropic':
        return new AnthropicProvider({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY || '' });
      case 'bedrock':
        return new AnthropicProvider({ bedrock: true, awsRegion: process.env.AWS_REGION });
      case 'openai':
        return new OpenAIProvider(apiKey || process.env.OPENAI_API_KEY || '');
      case 'gemini':
        return new GeminiProvider(apiKey || process.env.GOOGLE_API_KEY || '');
      case 'vertex':
        return new VertexProvider({
          project: process.env.GOOGLE_CLOUD_PROJECT,
          location: process.env.GOOGLE_CLOUD_LOCATION,
        });
      case 'ollama':
        return new OllamaProvider(process.env.OLLAMA_HOST);
      default:
        throw new Error(`Unknown provider: ${name}`);
    }
  }
}
