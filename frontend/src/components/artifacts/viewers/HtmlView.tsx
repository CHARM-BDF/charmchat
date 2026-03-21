import type { ViewerProps } from '../registry';

export default function HtmlView({ content }: ViewerProps) {
  return (
    <div
      className="prose prose-zinc dark:prose-invert max-w-none"
      dangerouslySetInnerHTML={{ __html: content }}
    />
  );
}
