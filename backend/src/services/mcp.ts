import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolDefinition, McpServersConfig, McpServerConfig, ServerStatus } from '../types/index.js';

export class MCPService {
  private clients = new Map<string, Client>();
  private serverTools = new Map<string, ToolDefinition[]>();
  private serverStatuses = new Map<string, ServerStatus>();

  async initialize(config: McpServersConfig): Promise<void> {
    // Clean up existing connections first
    await this.cleanup();

    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      try {
        await this.connectServer(name, serverConfig);
      } catch (err) {
        this.serverStatuses.set(name, {
          name,
          status: 'error',
          tools: [],
          error: String(err),
        });
      }
    }
  }

  private async connectServer(name: string, config: McpServerConfig): Promise<void> {
    const client = new Client(
      { name: 'charmgpt2', version: '1.0.0' },
      { capabilities: {} }
    );

    let transport;
    if (config.command) {
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args || [],
        env: { ...process.env, ...(config.env || {}) } as Record<string, string>,
      });
    } else {
      throw new Error(`Unsupported transport for server ${name}`);
    }

    await client.connect(transport);

    const { tools } = await client.listTools();
    const toolDefs: ToolDefinition[] = tools.map(t => ({
      name: `${name}__${t.name}`,
      description: t.description || '',
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));

    this.clients.set(name, client);
    this.serverTools.set(name, toolDefs);
    this.serverStatuses.set(name, { name, status: 'connected', tools: toolDefs });
  }

  getTools(excludeServers?: string[]): ToolDefinition[] {
    const allTools: ToolDefinition[] = [];
    for (const [name, tools] of this.serverTools) {
      if (!excludeServers?.includes(name)) {
        allTools.push(...tools);
      }
    }
    return allTools;
  }

  async callTool(qualifiedName: string, args: Record<string, unknown>): Promise<unknown> {
    const separatorIndex = qualifiedName.indexOf('__');
    if (separatorIndex === -1) throw new Error(`Invalid tool name: ${qualifiedName}`);

    const serverName = qualifiedName.substring(0, separatorIndex);
    const toolName = qualifiedName.substring(separatorIndex + 2);

    const client = this.clients.get(serverName);
    if (!client) throw new Error(`Server not found: ${serverName}`);

    const result = await client.callTool({ name: toolName, arguments: args });
    return result;
  }

  getStatus(): ServerStatus[] {
    return Array.from(this.serverStatuses.values());
  }

  async cleanup(): Promise<void> {
    for (const [, client] of this.clients) {
      try {
        await client.close();
      } catch {
        // ignore cleanup errors
      }
    }
    this.clients.clear();
    this.serverTools.clear();
    this.serverStatuses.clear();
  }
}
