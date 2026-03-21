import type { ViewerProps } from '../registry';

interface Citation {
  authors?: string[];
  year?: string;
  title?: string;
  journal?: string;
  pmid?: string;
}

export default function BibliographyView({ content }: ViewerProps) {
  let citations: Citation[] = [];
  try {
    const parsed = JSON.parse(content);
    citations = Array.isArray(parsed) ? parsed : [];
  } catch {
    return (
      <pre className="text-sm bg-zinc-50 dark:bg-zinc-900 rounded-xl p-4 overflow-auto whitespace-pre-wrap font-mono">
        {content}
      </pre>
    );
  }

  if (citations.length === 0) {
    return <p className="text-sm text-zinc-400">No citations</p>;
  }

  return (
    <div className="space-y-3">
      {citations.map((cite, i) => (
        <div
          key={cite.pmid || i}
          className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700"
        >
          <div className="text-sm font-medium mb-1">{cite.title || 'Untitled'}</div>
          <div className="text-xs text-zinc-500 space-y-0.5">
            {cite.authors && cite.authors.length > 0 && (
              <div>
                {cite.authors.slice(0, 5).join(', ')}
                {cite.authors.length > 5 && ` +${cite.authors.length - 5} more`}
              </div>
            )}
            <div className="flex items-center gap-2">
              {cite.journal && <span>{cite.journal}</span>}
              {cite.year && <span>({cite.year})</span>}
              {cite.pmid && (
                <a
                  href={`https://pubmed.ncbi.nlm.nih.gov/${cite.pmid}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-600 dark:text-accent-400 hover:underline font-mono"
                >
                  PMID:{cite.pmid}
                </a>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
