import type { ProviderName, LLMProvider } from '../../types/index.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { OpenAIProvider } from './providers/openai.js';
import { GeminiProvider } from './providers/gemini.js';
import { OllamaProvider } from './providers/ollama.js';
import { VertexProvider } from './providers/vertex.js';

export class LLMService {
  createProvider(name: ProviderName, apiKey?: string): LLMProvider {
    const k = (apiKey || '').trim();
    switch (name) {
      case 'anthropic': {
        const key = k || (process.env.ANTHROPIC_API_KEY || '').trim();
        if (!key) throw new Error('Anthropic API key is missing');
        return new AnthropicProvider({ apiKey: key });
      }
      case 'bedrock':
        return new AnthropicProvider({ bedrock: true, awsRegion: process.env.AWS_REGION });
      case 'openai': {
        const key = k || (process.env.OPENAI_API_KEY || '').trim();
        if (!key) throw new Error('OpenAI API key is missing');
        return new OpenAIProvider(key);
      }
      case 'gemini': {
        const key = k || (process.env.GOOGLE_API_KEY || '').trim();
        if (!key) throw new Error('Google API key is missing');
        return new GeminiProvider(key);
      }
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
