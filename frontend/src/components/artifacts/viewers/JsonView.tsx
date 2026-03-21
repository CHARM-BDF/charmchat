import { useState } from 'react';
import CodeBlock from '../CodeBlock';
import type { ViewerProps } from '../registry';

export default function JsonView({ content }: ViewerProps) {
  const [viewMode, setViewMode] = useState<'formatted' | 'raw'>('formatted');

  let formatted = content;
  try {
    formatted = JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    // not valid JSON, show as-is
  }

  return (
    <div>
      <div className="flex justify-end mb-2">
        <button
          onClick={() => setViewMode(viewMode === 'formatted' ? 'raw' : 'formatted')}
          className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors duration-150"
        >
          {viewMode === 'formatted' ? 'Show raw' : 'Show formatted'}
        </button>
      </div>
      <CodeBlock content={viewMode === 'formatted' ? formatted : content} language="json" />
    </div>
  );
}
