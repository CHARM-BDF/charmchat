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
import { TaintKeyProvenanceTracker, TAINT_KEY_SYSTEM_PROMPT, stripProvenanceBlock } from './provenance.js';

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
    options?: { model?: string; blockedServers?: string[]; blockedTools?: string[] }
  ): AsyncGenerator<SSEEvent> {
    const settings = this.storage.loadSettings();
    const apiKey = settings.apiKeys[provider];
    const llmProvider = this.llmService.createProvider(provider, apiKey);
    const tools = this.mcpService.getTools(options?.blockedServers, options?.blockedTools);

    const tracker = new TaintKeyProvenanceTracker();

    const allMessages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT + TAINT_KEY_SYSTEM_PROMPT },
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
        // Verify provenance from the structured <provenance> block
        const provenanceReport = tracker.verifyStructuredClaims(fullText);

        // Strip the <provenance> block from the displayed content
        const displayText = stripProvenanceBlock(fullText);

        // Parse artifacts from the cleaned text
        const artifacts = parseArtifacts(displayText);
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

        if (provenanceReport.hasEvidence || provenanceReport.claims.length > 0) {
          yield {
            event: 'provenance',
            data: provenanceReport as unknown as Record<string, unknown>,
          };
        }

        yield {
          event: 'done',
          data: {
            content: displayText,
            artifacts: artifacts.map(a => a.id),
            ...(provenanceReport.hasEvidence || provenanceReport.claims.length > 0
              ? { provenanceReport }
              : {}),
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
        const traceStartTime = Date.now();
        try {
          const result = await this.mcpService.callTool(tc.name, tc.arguments) as {
            content?: { type: string; text?: string; data?: string; mimeType?: string }[];
            artifacts?: { type: string; title: string; content: unknown }[];
          };

          // Extract text and images from MCP content blocks
          let textParts: string[] = [];
          const images: { data: string; mimeType: string }[] = [];

          if (result?.content && Array.isArray(result.content)) {
            for (const block of result.content) {
              if (block.type === 'text' && block.text) {
                textParts.push(block.text);
              } else if (block.type === 'image' && block.data && block.mimeType) {
                images.push({ data: block.data, mimeType: block.mimeType });
              }
            }
          } else {
            textParts.push(typeof result === 'string' ? result : JSON.stringify(result));
          }

          const resultStr = textParts.join('\n');

          // Send images as artifacts to the frontend
          for (const img of images) {
            const artifactId = uuidv4();
            yield {
              event: 'artifact',
              data: {
                id: artifactId,
                type: 'image',
                title: `Output from ${tc.name.split('__').pop() || tc.name}`,
                content: `data:${img.mimeType};base64,${img.data}`,
              },
            };
          }

          // Forward MCP tool artifacts to the frontend
          if (result?.artifacts && Array.isArray(result.artifacts)) {
            for (const art of result.artifacts) {
              const artifactId = uuidv4();
              yield {
                event: 'artifact',
                data: {
                  id: artifactId,
                  type: art.type,
                  title: art.title,
                  content: typeof art.content === 'string' ? art.content : JSON.stringify(art.content),
                },
              };
            }
          }

          // Taint the result with an evidence key for provenance tracking
          const { key: evidenceKey, annotatedResult } = tracker.addEvidence(tc, resultStr);

          // Frontend sees the original unkeyed result
          yield {
            event: 'tool_result',
            data: {
              toolCallId: tc.id,
              name: tc.name,
              result: resultStr,
            },
          };

          yield {
            event: 'trace_entry',
            data: {
              id: uuidv4(),
              tool: tc.name,
              args: tc.arguments,
              result: resultStr,
              timestamp: new Date(traceStartTime).toISOString(),
              durationMs: Date.now() - traceStartTime,
              evidenceKey,
            },
          };

          // LLM sees the taint-keyed result
          allMessages.push({
            role: 'tool',
            content: annotatedResult,
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
  const regex = /<artifact\s+type="([^"]+)"\s+title="([^"]*)"(?:\s+language="([^"]*)")?\s*>([\s\S]*?)<\/artifact>/g;

  let match;
  while ((match = regex.exec(text)) !== null) {
    artifacts.push({
      id: uuidv4(),
      type: match[1],
      title: match[2],
      content: match[4].trim(),
      ...(match[3] ? { language: match[3] } : {}),
    });
  }

  return artifacts;
}
