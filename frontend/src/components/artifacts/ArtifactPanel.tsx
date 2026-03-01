import { useState } from 'react';
import { Copy, Download, X } from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';
import CodeBlock from './CodeBlock';
import MarkdownView from './MarkdownView';
import MermaidDiagram from './MermaidDiagram';

export default function ArtifactPanel() {
  const artifacts = useChatStore((s) => s.artifacts);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  if (!visible || artifacts.length === 0) return null;

  const artifact = artifacts[Math.min(selectedIndex, artifacts.length - 1)];

  const handleCopy = async () => {
    await navigator.clipboard.writeText(artifact.content);
  };

  const handleDownload = () => {
    const ext =
      artifact.type === 'code'
        ? artifact.language || 'txt'
        : artifact.type === 'markdown'
          ? 'md'
          : artifact.type === 'mermaid'
            ? 'mmd'
            : 'html';
    const blob = new Blob([artifact.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${artifact.title.replace(/\s+/g, '-').toLowerCase()}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-[45%] border-l border-zinc-200 dark:border-zinc-800 flex flex-col bg-white dark:bg-zinc-950">
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
            onClick={() => setVisible(false)}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors duration-150"
            title="Close panel"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {artifact.type === 'code' && (
          <CodeBlock content={artifact.content} language={artifact.language} />
        )}
        {artifact.type === 'markdown' && <MarkdownView content={artifact.content} />}
        {artifact.type === 'mermaid' && <MermaidDiagram content={artifact.content} />}
        {artifact.type === 'html' && (
          <div
            className="prose prose-zinc dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: artifact.content }}
          />
        )}
      </div>
    </div>
  );
}
