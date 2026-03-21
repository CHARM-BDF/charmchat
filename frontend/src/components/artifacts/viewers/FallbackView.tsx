import type { ViewerProps } from '../registry';

export default function FallbackView({ content }: ViewerProps) {
  return (
    <pre className="text-sm bg-zinc-50 dark:bg-zinc-900 rounded-xl p-4 overflow-auto whitespace-pre-wrap break-words font-mono">
      {content}
    </pre>
  );
}
