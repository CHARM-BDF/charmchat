import { v4 as uuidv4 } from 'uuid';
import type {
  ChatMessage,
  SSEEvent,
  Artifact,
  ProviderName,
  ToolCall,
} from '../types/index.js';
import { LLMService } from './llm/index.js';
import { MCPService } from './mcp.js';
import { StorageService } from './storage.js';

const SYSTEM_PROMPT = `You are a helpful assistant. When you want to show code, diagrams, or rich content, wrap them in artifact tags:

<artifact type="code" title="example.py" language="python">
print("hello")
</artifact>

<artifact type="mermaid" title="Flow diagram">
graph TD
    A --> B
</artifact>

<artifact type="markdown" title="Summary">
# Results
...
</artifact>

Supported types: code, markdown, mermaid, html`;

const MAX_ITERATIONS = 10;

export class ChatService {
  private llmService: LLMService;
  private mcpService: MCPService;
  private storage: StorageService;

  constructor(llmService: LLMService, mcpService: MCPService, storage: StorageService) {
    this.llmService = llmService;
    this.mcpService = mcpService;
    this.storage = storage;
  }

  async *run(
    messages: ChatMessage[],
    provider: ProviderName,
    options?: { model?: string; blockedServers?: string[] }
  ): AsyncGenerator<SSEEvent> {
    const settings = this.storage.loadSettings();
    const apiKey = settings.apiKeys[provider];
    const llmProvider = this.llmService.createProvider(provider, apiKey);
    const tools = this.mcpService.getTools(options?.blockedServers);

    const allMessages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages,
    ];

    let iteration = 0;

    while (iteration < MAX_ITERATIONS) {
      iteration++;
      let fullText = '';
      const pendingToolCalls: ToolCall[] = [];

      for await (const event of llmProvider.stream(
        allMessages,
        tools.length > 0 ? tools : undefined,
        { model: options?.model }
      )) {
        if (event.type === 'delta' && event.content) {
          fullText += event.content;
          yield {
            event: 'delta',
            data: { content: event.content },
          };
        } else if (event.type === 'tool_call' && event.toolCall) {
          pendingToolCalls.push(event.toolCall);
          yield {
            event: 'tool_call',
            data: {
              id: event.toolCall.id,
              name: event.toolCall.name,
              arguments: event.toolCall.arguments,
            },
          };
        } else if (event.type === 'error') {
          yield {
            event: 'error',
            data: { error: event.error || 'Unknown error' },
          };
          return;
        } else if (event.type === 'done') {
          // Will handle after the loop
        }
      }

      // If no tool calls, we're done
      if (pendingToolCalls.length === 0) {
        // Parse artifacts from the accumulated text
        const artifacts = parseArtifacts(fullText);
        for (const artifact of artifacts) {
          yield {
            event: 'artifact',
            data: {
              id: artifact.id,
              type: artifact.type,
              title: artifact.title,
              content: artifact.content,
              ...(artifact.language ? { language: artifact.language } : {}),
            },
          };
        }

        yield {
          event: 'done',
          data: {
            content: fullText,
            artifacts: artifacts.map(a => a.id),
          },
        };
        return;
      }

      // Execute tool calls
      // Add assistant message with tool calls to history
      allMessages.push({
        role: 'assistant',
        content: fullText,
        toolCalls: pendingToolCalls,
      });

      for (const tc of pendingToolCalls) {
        try {
          const result = await this.mcpService.callTool(tc.name, tc.arguments);
          const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

          yield {
            event: 'tool_result',
            data: {
              toolCallId: tc.id,
              name: tc.name,
              result: resultStr,
            },
          };

          allMessages.push({
            role: 'tool',
            content: resultStr,
            toolCallId: tc.id,
          });
        } catch (err) {
          const errorStr = `Error calling tool ${tc.name}: ${String(err)}`;
          yield {
            event: 'tool_result',
            data: {
              toolCallId: tc.id,
              name: tc.name,
              result: errorStr,
              isError: true,
            },
          };

          allMessages.push({
            role: 'tool',
            content: errorStr,
            toolCallId: tc.id,
          });
        }
      }

      // Continue the loop to get more LLM output
    }

    // Max iterations reached
    yield {
      event: 'error',
      data: { error: 'Maximum tool call iterations reached' },
    };
  }
}

function parseArtifacts(text: string): Artifact[] {
  const artifacts: Artifact[] = [];
  const regex = /<artifact\s+type="(code|markdown|mermaid|html)"\s+title="([^"]*)"(?:\s+language="([^"]*)")?\s*>([\s\S]*?)<\/artifact>/g;

  let match;
  while ((match = regex.exec(text)) !== null) {
    artifacts.push({
      id: uuidv4(),
      type: match[1] as Artifact['type'],
      title: match[2],
      content: match[4].trim(),
      ...(match[3] ? { language: match[3] } : {}),
    });
  }

  return artifacts;
}
