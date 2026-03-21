import MermaidDiagram from '../MermaidDiagram';
import type { ViewerProps } from '../registry';

export default function MermaidView({ content }: ViewerProps) {
  return <MermaidDiagram content={content} />;
}
