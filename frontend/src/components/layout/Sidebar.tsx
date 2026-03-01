import { useState } from 'react';
import {
  Plus,
  Trash2,
  Settings,
  PanelLeftClose,
  PanelRightClose,
  MessageSquare,
} from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';
import McpStatusBar from '../mcp/McpStatusBar';
import SettingsModal from '../settings/SettingsModal';

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const conversationList = useChatStore((s) => s.conversationList);
  const conversationId = useChatStore((s) => s.conversationId);
  const loadConversation = useChatStore((s) => s.loadConversation);
  const newConversation = useChatStore((s) => s.newConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);

  if (collapsed) {
    return (
      <div className="w-12 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 flex flex-col items-center py-3 gap-3">
        <button
          onClick={() => setCollapsed(false)}
          className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors duration-150"
          title="Expand sidebar"
        >
          <PanelRightClose size={18} />
        </button>
        <button
          onClick={newConversation}
          className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors duration-150"
          title="New chat"
        >
          <Plus size={18} />
        </button>
        <div className="flex-1" />
        <button
          onClick={() => setSettingsOpen(true)}
          className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors duration-150"
          title="Settings"
        >
          <Settings size={18} />
        </button>
        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      </div>
    );
  }

  return (
    <div className="w-64 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 flex flex-col">
      {/* Header */}
      <div className="h-14 flex items-center justify-between px-3 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCollapsed(true)}
            className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors duration-150"
            title="Collapse sidebar"
          >
            <PanelLeftClose size={18} />
          </button>
          <span className="font-semibold text-sm tracking-tight">CharmGPT2</span>
        </div>
        <button
          onClick={newConversation}
          className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors duration-150"
          title="New chat"
        >
          <Plus size={18} />
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto py-2 px-2">
        {conversationList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-zinc-400 dark:text-zinc-600 text-xs">
            <MessageSquare size={24} className="mb-2" />
            <span>No conversations yet</span>
          </div>
        ) : (
          conversationList.map((conv) => (
            <div
              key={conv.id}
              onClick={() => loadConversation(conv.id)}
              onMouseEnter={() => setHoveredId(conv.id)}
              onMouseLeave={() => setHoveredId(null)}
              className={`px-3 py-2 rounded-lg cursor-pointer text-sm mb-0.5 flex items-center justify-between group transition-colors duration-150 ${
                conv.id === conversationId
                  ? 'bg-accent-100 dark:bg-accent-700/20 text-accent-700 dark:text-accent-300'
                  : 'hover:bg-zinc-200 dark:hover:bg-zinc-800'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate">{conv.name}</div>
                <div className="text-[10px] text-zinc-400 dark:text-zinc-600 mt-0.5">
                  {timeAgo(conv.updated)}
                </div>
              </div>
              {hoveredId === conv.id && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConversation(conv.id);
                  }}
                  className="p-1 rounded hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors duration-150 ml-1 flex-shrink-0"
                  title="Delete conversation"
                >
                  <Trash2 size={14} className="text-zinc-400 hover:text-red-500" />
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Bottom section */}
      <McpStatusBar onClick={() => setSettingsOpen(true)} />
      <div className="px-3 py-2 border-t border-zinc-200 dark:border-zinc-800">
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors duration-150 w-full py-1"
        >
          <Settings size={14} />
          <span>Settings</span>
        </button>
      </div>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
