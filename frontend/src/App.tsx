import { useEffect } from 'react';
import Sidebar from './components/layout/Sidebar';
import ChatPanel from './components/chat/ChatPanel';
import ArtifactPanel from './components/artifacts/ArtifactPanel';
import WorkflowRunner from './components/workflow/WorkflowRunner';
import { useSettingsStore } from './stores/settingsStore';
import { useChatStore } from './stores/chatStore';
import { useMcpStore } from './stores/mcpStore';
import { useWorkflowStore } from './stores/workflowStore';

export default function App() {
  const theme = useSettingsStore((s) => s.theme);
  const artifacts = useChatStore((s) => s.artifacts);
  const fetchConversationList = useChatStore((s) => s.fetchConversationList);
  const fetchStatus = useMcpStore((s) => s.fetchStatus);
  const loadBlockedState = useMcpStore((s) => s.loadBlockedState);
  const fetchModels = useSettingsStore((s) => s.fetchModels);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const selectedWorkflow = useWorkflowStore((s) => s.selectedWorkflow);
  const fetchWorkflows = useWorkflowStore((s) => s.fetchWorkflows);

  useEffect(() => {
    loadSettings();
    fetchConversationList();
    fetchStatus();
    loadBlockedState();
    fetchModels();
    fetchWorkflows();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else if (theme === 'light') {
      root.classList.remove('dark');
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (prefersDark) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    }
  }, [theme]);

  const artifactPanelVisible = useChatStore((s) => s.artifactPanelVisible);
  const hasArtifacts = artifacts.length > 0;

  return (
    <div className="flex h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      <Sidebar />
      {selectedWorkflow ? <WorkflowRunner /> : <ChatPanel />}
      {hasArtifacts && artifactPanelVisible && !selectedWorkflow && <ArtifactPanel />}
    </div>
  );
}
