import { lazy, type ComponentType } from 'react';

export interface ViewerProps {
  content: string;
  title: string;
  language?: string;
}

type ViewerImport = () => Promise<{ default: ComponentType<ViewerProps> }>;

const viewers: Record<string, ViewerImport> = {
  'code':             () => import('./viewers/CodeView'),
  'markdown':         () => import('./viewers/MarkdownView'),
  'text/markdown':    () => import('./viewers/MarkdownView'),
  'mermaid':          () => import('./viewers/MermaidView'),
  'html':             () => import('./viewers/HtmlView'),
  'image':            () => import('./viewers/ImageView'),
  'bibliography':                  () => import('./viewers/BibliographyView'),
  'application/vnd.bibliography':  () => import('./viewers/BibliographyView'),
  'knowledge-graph':               () => import('./viewers/KnowledgeGraphView'),
  'application/vnd.knowledge-graph': () => import('./viewers/KnowledgeGraphView'),
  'json':                          () => import('./viewers/JsonView'),
};

// Fallback for unknown types
const fallback: ViewerImport = () => import('./viewers/FallbackView');

export function getViewer(type: string) {
  return lazy(viewers[type] || fallback);
}
