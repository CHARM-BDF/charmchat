import { useEffect, useState, useId, useRef, useCallback } from 'react';
import mermaid from 'mermaid';
import { Eye, EyeOff, RotateCcw } from 'lucide-react';

interface Props {
  content: string;
}

export default function MermaidDiagram({ content }: Props) {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [showSource, setShowSource] = useState(false);
  const uniqueId = useId().replace(/:/g, '');
  const isDark = document.documentElement.classList.contains('dark');

  // Pan & zoom state
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, startTx: 0, startTy: 0 });

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

  // Reset transform when content changes
  useEffect(() => {
    setTransform({ x: 0, y: 0, scale: 1 });
  }, [content]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform(prev => {
      const newScale = Math.max(0.1, Math.min(5, prev.scale * delta));
      // Zoom toward cursor
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { ...prev, scale: newScale };
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      return {
        scale: newScale,
        x: cx - (cx - prev.x) * (newScale / prev.scale),
        y: cy - (cy - prev.y) * (newScale / prev.scale),
      };
    });
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, startTx: transform.x, startTy: transform.y };
  }, [transform]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current.dragging) return;
    setTransform(prev => ({
      ...prev,
      x: dragRef.current.startTx + (e.clientX - dragRef.current.startX),
      y: dragRef.current.startTy + (e.clientY - dragRef.current.startY),
    }));
  }, []);

  const handleMouseUp = useCallback(() => {
    dragRef.current.dragging = false;
  }, []);

  const resetView = useCallback(() => {
    setTransform({ x: 0, y: 0, scale: 1 });
  }, []);

  const isTransformed = transform.x !== 0 || transform.y !== 0 || transform.scale !== 1;

  return (
    <div>
      <div className="flex justify-end mb-2 gap-2">
        {isTransformed && (
          <button
            onClick={resetView}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors duration-150"
          >
            <RotateCcw size={14} />
            <span>Reset view</span>
          </button>
        )}
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
          ref={containerRef}
          className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700 cursor-grab active:cursor-grabbing"
          style={{ minHeight: 200 }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <div
            style={{
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
              transformOrigin: '0 0',
              transition: dragRef.current.dragging ? 'none' : 'transform 0.1s ease-out',
            }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      ) : (
        <div className="flex justify-center py-8 text-zinc-400">
          <div className="animate-pulse text-sm">Rendering diagram...</div>
        </div>
      )}
    </div>
  );
}
