import { useEffect, useState, useId } from 'react';
import mermaid from 'mermaid';
import { Eye, EyeOff } from 'lucide-react';

interface Props {
  content: string;
}

export default function MermaidDiagram({ content }: Props) {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [showSource, setShowSource] = useState(false);
  const uniqueId = useId().replace(/:/g, '');
  const isDark = document.documentElement.classList.contains('dark');

  useEffect(() => {
    let cancelled = false;

    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'default',
      securityLevel: 'loose',
    });

    mermaid
      .render(`mermaid-${uniqueId}`, content)
      .then(({ svg: renderedSvg }) => {
        if (!cancelled) {
          setSvg(renderedSvg);
          setError('');
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'Failed to render diagram');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [content, isDark, uniqueId]);

  return (
    <div>
      <div className="flex justify-end mb-2">
        <button
          onClick={() => setShowSource(!showSource)}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors duration-150"
        >
          {showSource ? <EyeOff size={14} /> : <Eye size={14} />}
          <span>{showSource ? 'Hide source' : 'View source'}</span>
        </button>
      </div>

      {showSource && (
        <pre className="bg-zinc-100 dark:bg-zinc-800 rounded-xl p-4 text-xs font-mono mb-4 overflow-auto">
          {content}
        </pre>
      )}

      {error ? (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-sm text-red-700 dark:text-red-300">
          Failed to render diagram: {error}
        </div>
      ) : svg ? (
        <div
          className="flex justify-center overflow-auto"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="flex justify-center py-8 text-zinc-400">
          <div className="animate-pulse text-sm">Rendering diagram...</div>
        </div>
      )}
    </div>
  );
}
