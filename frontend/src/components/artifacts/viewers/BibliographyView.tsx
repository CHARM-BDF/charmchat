import { useState } from 'react';
import type { ViewerProps } from '../registry';

interface Citation {
  authors?: string[];
  year?: string;
  title?: string;
  journal?: string;
  pmid?: string;
  abstract?: string;
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

  const hasAnyAbstract = citations.some(c => c.abstract && c.abstract !== 'No abstract available');

  return <BibliographyList citations={citations} hasAnyAbstract={hasAnyAbstract} />;
}

function BibliographyList({ citations, hasAnyAbstract }: { citations: Citation[]; hasAnyAbstract: boolean }) {
  const [expandedAll, setExpandedAll] = useState(false);
  const [expandedSet, setExpandedSet] = useState<Set<number>>(new Set());

  const toggleOne = (index: number) => {
    setExpandedSet(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleAll = () => {
    if (expandedAll) {
      setExpandedAll(false);
      setExpandedSet(new Set());
    } else {
      setExpandedAll(true);
      setExpandedSet(new Set(citations.map((_, i) => i)));
    }
  };

  const isExpanded = (index: number) => expandedSet.has(index);

  return (
    <div className="space-y-3">
      {hasAnyAbstract && (
        <button
          onClick={toggleAll}
          className="text-xs text-accent-600 dark:text-accent-400 hover:underline"
        >
          {expandedAll ? 'Hide all abstracts' : 'Show all abstracts'}
        </button>
      )}
      {citations.map((cite, i) => {
        const hasAbstract = cite.abstract && cite.abstract !== 'No abstract available';
        return (
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
            {hasAbstract && (
              <div className="mt-2">
                <button
                  onClick={() => toggleOne(i)}
                  className="text-xs text-accent-600 dark:text-accent-400 hover:underline"
                >
                  {isExpanded(i) ? 'Hide abstract' : 'Show abstract'}
                </button>
                {isExpanded(i) && (
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                    {cite.abstract}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
