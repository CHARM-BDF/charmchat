import MarkdownViewComponent from '../MarkdownView';
import type { ViewerProps } from '../registry';

export default function MarkdownViewViewer({ content }: ViewerProps) {
  return <MarkdownViewComponent content={content} />;
}
