import CodeBlock from '../CodeBlock';
import type { ViewerProps } from '../registry';

export default function CodeView({ content, language }: ViewerProps) {
  return <CodeBlock content={content} language={language} />;
}
