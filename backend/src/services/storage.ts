import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Conversation, ConversationMeta, McpServersConfig, Settings } from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '..', '..', '..', 'data');
const CONVERSATIONS_DIR = path.join(DATA_DIR, 'conversations');
const CONFIG_DIR = path.join(DATA_DIR, 'config');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const DEFAULT_SETTINGS: Settings = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  theme: 'system',
  apiKeys: {},
};

export class StorageService {
  constructor() {
    ensureDir(CONVERSATIONS_DIR);
    ensureDir(CONFIG_DIR);
  }

  listConversations(): ConversationMeta[] {
    ensureDir(CONVERSATIONS_DIR);
    const files = fs.readdirSync(CONVERSATIONS_DIR).filter(f => f.endsWith('.json'));
    const metas: ConversationMeta[] = [];

    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(CONVERSATIONS_DIR, file), 'utf-8');
        const conv: Conversation = JSON.parse(raw);
        metas.push({
          id: conv.id,
          name: conv.name,
          created: conv.created,
          updated: conv.updated,
          messageCount: conv.messages.length,
        });
      } catch {
        // skip invalid files
      }
    }

    return metas.sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());
  }

  loadConversation(id: string): Conversation | null {
    const filePath = path.join(CONVERSATIONS_DIR, `${id}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as Conversation;
    } catch {
      return null;
    }
  }

  saveConversation(conversation: Conversation): void {
    ensureDir(CONVERSATIONS_DIR);
    const filePath = path.join(CONVERSATIONS_DIR, `${conversation.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(conversation, null, 2), 'utf-8');
  }

  deleteConversation(id: string): void {
    const filePath = path.join(CONVERSATIONS_DIR, `${id}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  loadMcpConfig(): McpServersConfig {
    const filePath = path.join(CONFIG_DIR, 'mcp-servers.json');
    if (!fs.existsSync(filePath)) {
      return { mcpServers: {} };
    }
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as McpServersConfig;
    } catch {
      return { mcpServers: {} };
    }
  }

  saveMcpConfig(config: McpServersConfig): void {
    ensureDir(CONFIG_DIR);
    const filePath = path.join(CONFIG_DIR, 'mcp-servers.json');
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
  }

  loadSettings(): Settings {
    const filePath = path.join(CONFIG_DIR, 'settings.json');
    if (!fs.existsSync(filePath)) {
      return { ...DEFAULT_SETTINGS };
    }
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as Settings;
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  saveSettings(settings: Settings): void {
    ensureDir(CONFIG_DIR);
    const filePath = path.join(CONFIG_DIR, 'settings.json');
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
  }
}
