import { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { Copy, Download, X } from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';
import { renderCitationLinks } from '../../lib/citations';
import { getViewer } from './registry';
import type { ProvenanceReport } from '../../types';

export default function ArtifactPanel() {
  const artifacts = useChatStore((s) => s.artifacts);
  const messages = useChatStore((s) => s.messages);
  const artifactPanelVisible = useChatStore((s) => s.artifactPanelVisible);
  const setArtifactPanelVisible = useChatStore((s) => s.setArtifactPanelVisible);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const prevCount = useRef(0);

  // Auto-select latest artifact when new ones arrive, and re-show panel
  useEffect(() => {
    if (artifacts.length > prevCount.current) {
      setSelectedIndex(artifacts.length - 1);
      setArtifactPanelVisible(true);
    }
    prevCount.current = artifacts.length;
  }, [artifacts.length]);

  // Build a map from artifact id → provenanceReport of its parent message
  const artifactProvenance = useMemo(() => {
    const map = new Map<string, ProvenanceReport>();
    for (const msg of messages) {
      if (msg.provenanceReport && msg.artifactIds) {
        for (const aid of msg.artifactIds) {
          map.set(aid, msg.provenanceReport);
        }
      }
    }
    return map;
  }, [messages]);

  if (!artifactPanelVisible || artifacts.length === 0) return null;

  const artifact = artifacts[Math.min(selectedIndex, artifacts.length - 1)];
  const report = artifactProvenance.get(artifact.id);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(artifact.content);
  };

  const handleDownload = () => {
    if (artifact.type === 'image') {
      const a = document.createElement('a');
      a.href = artifact.content;
      a.download = `${artifact.title.replace(/\s+/g, '-').toLowerCase()}.png`;
      a.click();
      return;
    }
    const extMap: Record<string, string> = {
      markdown: 'md',
      mermaid: 'mmd',
      html: 'html',
      json: 'json',
      bibliography: 'json',
      'knowledge-graph': 'json',
    };
    const ext = extMap[artifact.type] || artifact.language || 'txt';
    const blob = new Blob([artifact.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${artifact.title.replace(/\s+/g, '-').toLowerCase()}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const Viewer = getViewer(artifact.type);

  // Apply citation rendering for text-based artifacts that have provenance
  const textTypes = new Set(['markdown', 'text/markdown', 'html']);
  const displayContent = report && textTypes.has(artifact.type)
    ? renderCitationLinks(artifact.content, report)
    : artifact.content;

  return (
    <div className="w-[40%] max-w-[600px] border-l border-zinc-200 dark:border-zinc-800 flex flex-col bg-white dark:bg-zinc-950 flex-shrink-0">
      {/* Header */}
      <div className="h-14 border-b border-zinc-200 dark:border-zinc-800 flex items-center px-4 justify-between gap-2">
        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto min-w-0">
          {artifacts.map((a, i) => (
            <button
              key={a.id}
              onClick={() => setSelectedIndex(i)}
              className={`px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors duration-150 ${
                i === selectedIndex
                  ? 'bg-accent-100 dark:bg-accent-700/20 text-accent-700 dark:text-accent-300'
                  : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              {a.title}
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-1 flex-shrink-0">
          <button
            onClick={handleCopy}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors duration-150"
            title="Copy content"
          >
            <Copy size={16} />
          </button>
          <button
            onClick={handleDownload}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors duration-150"
            title="Download"
          >
            <Download size={16} />
          </button>
          <button
            onClick={() => setArtifactPanelVisible(false)}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors duration-150"
            title="Close panel"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        <Suspense
          fallback={
            <div className="flex justify-center py-8 text-zinc-400">
              <div className="animate-pulse text-sm">Loading viewer...</div>
            </div>
          }
        >
          <Viewer
            content={displayContent}
            title={artifact.title}
            language={artifact.language}
          />
        </Suspense>
      </div>
    </div>
  );
}
