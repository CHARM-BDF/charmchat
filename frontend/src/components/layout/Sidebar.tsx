import { useEffect, useState } from 'react';
import {
  Plus,
  Trash2,
  Settings,
  PanelLeftClose,
  PanelRightClose,
  MessageSquare,
  GitBranch,
  ChevronDown,
  ChevronRight,
  ThumbsDown,
} from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';
import { useWorkflowStore } from '../../stores/workflowStore';
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
  const [workflowsOpen, setWorkflowsOpen] = useState(true);
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    window.addEventListener('popstate', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('popstate', onChange);
    };
  }, []);

  const dislikedOnly = hash === '#/disliked';

  const conversationList = useChatStore((s) => s.conversationList);
  const conversationId = useChatStore((s) => s.conversationId);
  const loadConversation = useChatStore((s) => s.loadConversation);
  const newConversation = useChatStore((s) => s.newConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);

  const visibleConversations = dislikedOnly
    ? conversationList.filter((c) => c.hasDisliked)
    : conversationList;

  const setRoute = (next: 'disliked' | 'all') => {
    const base = window.location.pathname + window.location.search;
    const url = next === 'disliked' ? `${base}#/disliked` : base;
    window.history.pushState(null, '', url);
    setHash(next === 'disliked' ? '#/disliked' : '');
  };

  const workflows = useWorkflowStore((s) => s.workflows);
  const selectedWorkflow = useWorkflowStore((s) => s.selectedWorkflow);
  const selectWorkflow = useWorkflowStore((s) => s.selectWorkflow);
  const clearSelection = useWorkflowStore((s) => s.clearSelection);
  const toggleWorkflow = useWorkflowStore((s) => s.toggleWorkflow);
  const deleteWorkflow = useWorkflowStore((s) => s.deleteWorkflow);

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
          onClick={() => { clearSelection(); newConversation(); }}
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
          <span className="font-semibold text-sm tracking-tight">CharmChat</span>
        </div>
        <button
          onClick={() => { clearSelection(); newConversation(); }}
          className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors duration-150"
          title="New chat"
        >
          <Plus size={18} />
        </button>
      </div>

      {/* Filter indicator — only visible when filtered */}
      {dislikedOnly && (
        <div className="px-3 pt-2 pb-1">
          <button
            onClick={() => setRoute('all')}
            className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md bg-accent-100 dark:bg-accent-700/20 text-accent-700 dark:text-accent-300 transition-colors duration-150"
            title="Show all conversations"
          >
            <ThumbsDown size={11} />
            <span>Disliked only</span>
          </button>
        </div>
      )}

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto py-2 px-2">
        {visibleConversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-zinc-400 dark:text-zinc-600 text-xs">
            <MessageSquare size={24} className="mb-2" />
            <span>{dislikedOnly ? 'No disliked conversations' : 'No conversations yet'}</span>
          </div>
        ) : (
          visibleConversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => {
                clearSelection();
                loadConversation(conv.id);
              }}
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

      {/* Workflows section */}
      <div className="border-t border-zinc-200 dark:border-zinc-800">
        <button
          onClick={() => setWorkflowsOpen(!workflowsOpen)}
          className="flex items-center gap-1.5 w-full px-3 py-2 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors duration-150"
        >
          {workflowsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <GitBranch size={12} />
          <span>Workflows</span>
          {workflows.length > 0 && (
            <span className="ml-auto text-[10px] text-zinc-400">{workflows.length}</span>
          )}
        </button>
        {workflowsOpen && (
          <div className="px-2 pb-2 max-h-40 overflow-y-auto">
            {workflows.length === 0 ? (
              <div className="text-[10px] text-zinc-400 dark:text-zinc-600 text-center py-2">
                No workflows yet
              </div>
            ) : (
              workflows.map((wf) => (
                <div
                  key={wf.id}
                  onClick={() => selectWorkflow(wf.id)}
                  onMouseEnter={() => setHoveredId(`wf-${wf.id}`)}
                  onMouseLeave={() => setHoveredId(null)}
                  className={`px-3 py-1.5 rounded-lg cursor-pointer text-xs mb-0.5 flex items-center gap-1.5 transition-colors duration-150 ${
                    selectedWorkflow?.id === wf.id
                      ? 'bg-accent-100 dark:bg-accent-700/20 text-accent-700 dark:text-accent-300'
                      : 'hover:bg-zinc-200 dark:hover:bg-zinc-800'
                  } ${!wf.enabled ? 'opacity-50' : ''}`}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleWorkflow(wf.id);
                    }}
                    className={`w-6 h-3.5 rounded-full flex-shrink-0 relative transition-colors duration-150 ${
                      wf.enabled
                        ? 'bg-accent-500'
                        : 'bg-zinc-300 dark:bg-zinc-600'
                    }`}
                    title={wf.enabled ? 'Disable workflow' : 'Enable workflow'}
                  >
                    <div
                      className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow-sm transition-transform duration-150 ${
                        wf.enabled ? 'translate-x-3' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{wf.name}</div>
                    <div className="text-[10px] text-zinc-400 dark:text-zinc-600">
                      {wf.nodeCount} steps
                    </div>
                  </div>
                  {hoveredId === `wf-${wf.id}` && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteWorkflow(wf.id);
                      }}
                      className="p-0.5 rounded hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors duration-150 ml-1 flex-shrink-0"
                      title="Delete workflow"
                    >
                      <Trash2 size={12} className="text-zinc-400 hover:text-red-500" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
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
