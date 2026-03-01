import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy } from 'lucide-react';
import { useState } from 'react';

interface Props {
  content: string;
  language?: string;
}

export default function CodeBlock({ content, language = 'text' }: Props) {
  const [copied, setCopied] = useState(false);
  const isDark = document.documentElement.classList.contains('dark');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative rounded-xl overflow-hidden text-sm group">
      {/* Language label + copy button */}
      <div className="flex items-center justify-between bg-zinc-200 dark:bg-zinc-800 px-4 py-1.5 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="font-mono">{language}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors duration-150"
        >
          <Copy size={12} />
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <SyntaxHighlighter
        language={language}
        style={isDark ? oneDark : oneLight}
        showLineNumbers
        customStyle={{
          margin: 0,
          borderRadius: 0,
          fontSize: '13px',
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        }}
      >
        {content}
      </SyntaxHighlighter>
    </div>
  );
}
